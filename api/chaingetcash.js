import Web3 from "web3";
import fetch from "node-fetch";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;      // Base mainnet RPC
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;      // Admin wallet
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;      // https://chainvers.free.nf

/* -------------------- fallback -------------------- */
const RPC_FALLBACKS = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

/* ======================= Web3 init ======================= */
async function getWeb3() {
  for (const rpc of RPC_FALLBACKS) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✅ Using RPC:", rpc);
      return w3;
    } catch (e) {
      console.log("⚠️ RPC fail:", rpc);
    }
  }
  throw new Error("No working RPC");
}
const web3 = await getWeb3();

/* ======================= ABI ======================= */
const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

/* ======================= LOGY ======================= */
async function sendLog(msg) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`
      })
    });
  } catch (e) {}
}
const log = (...m) => {
  const line = m.join(" ");
  console.log(line);
  sendLog(line);
};

/* ======================= ETH RATE ======================= */
async function getEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    log(`💱 1 ETH = ${rate} €`);
    return rate || 2500;
  } catch (e) {
    log("⚠️ CoinGecko fail → 2500 fallback");
    return 2500;
  }
}

/* ======================= GAS ======================= */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

/* ======================= LOAD ORDER (IF) ======================= */
async function loadOrder(payment_id) {
  const url = `${INF_FREE_URL}/chainuserdata`;
  log("ℹ️ Loading order from IF:", payment_id);

  const r = await fetch(`${url}?list=1`);
  // accptpay neposkytuje API → manuálne

  throw new Error("loadOrder() nie je potrebný – accptpay posiela všetky údaje");
}

/* ======================= UPDATE IF ======================= */
async function updateIF(payment_id, tx_hash) {
  log("↩️ update_order prebieha:", payment_id);

  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: payment_id,
        tx_hash: tx_hash
      })
    });

    const txt = await r.text();
    log("↩️ IF odpoveď:", txt);
    return txt;
  } catch (e) {
    log("❌ update_order FAIL:", e.message);
    return null;
  }
}

/* ======================= FUND TOKEN ======================= */
async function fund(user, tokenId, amountEth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const valueWei = web3.utils.toWei(amountEth.toString(), "ether");
  const gasPrice = await getGas();

  const gasLimit = await contract.methods
    .fundTokenFor(user, tokenId)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.fundTokenFor(user, tokenId).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`🔥 MINT done: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ======================= MAIN HANDLER ======================= */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const action = req.body?.action;

    if (!action) {
      return res.status(400).json({ ok:false, error:"Missing action" });
    }

    /* ========== SINGLE MINT (do_mint) ========== */
    if (action === "mint") {
      const payment_id = req.body.payment_id;
      const user       = req.body.user_address;
      const token      = req.body.token_id;
      const eur        = parseFloat(req.body.amount_eur);

      if (!payment_id || !user || !token) {
        return res.status(400).json({ ok:false, error:"Missing fields" });
      }

      const rate = await getEthRate();
      const eth  = eur > 0 ? eur / rate : 0.001;

      log(`🔥 MINT: ${payment_id} → token ${token} → ${eth} ETH`);

      const tx = await fund(user, token, eth);
      await updateIF(payment_id, tx);

      return res.status(200).json({
        ok: true,
        payment_id,
        token_id: token,
        user_address: user,
        sent_eth: eth,
        tx_hash: tx
      });
    }

    /* ========== FUTURE: MINT ALL ========== */
    if (action === "mint_all") {
      return res.status(501).json({ ok:false, error:"mint_all not implemented" });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch (e) {
    log("❌ ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}