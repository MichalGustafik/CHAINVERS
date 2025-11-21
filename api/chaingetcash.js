import Web3 from "web3";
import fetch from "node-fetch";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;      
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;      
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

/* -------------------- fallback RPC -------------------- */
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

/* ======================= BALANCE ======================= */
async function getBalanceEth() {
  const wei = await web3.eth.getBalance(FROM);
  return parseFloat(web3.utils.fromWei(wei, "ether"));
}

/* ======================= SMART TOP-UP ======================= */
async function topUp(missingEth) {
  const wei = web3.utils.toWei(missingEth.toString(), "ether");
  const gasPrice = await getGas();
  const nonce = await web3.eth.getTransactionCount(FROM, "pending");
  const chainId = await web3.eth.getChainId();

  const tx = {
    from: FROM,
    to: FROM,
    value: wei,
    gas: 21000,
    gasPrice,
    nonce,
    chainId
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`⚡ TOPUP done → ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ======================= FUND TOKEN ======================= */
async function executeFund(user, tokenId) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const gasPrice = await getGas();

  // Vypočítame minimálny gas
  const gasLimit = await contract.methods
    .fundTokenFor(user, tokenId)
    .estimateGas({ from: FROM, value: 0 });

  const requiredEth = gasLimit * gasPrice;
  const requiredEthNorm = requiredEth / 1e18;

  const bal = await getBalanceEth();

  log(`🔍 GasLimit=${gasLimit} | Need=${requiredEthNorm} ETH | Bal=${bal}`);

  if (bal < requiredEthNorm) {
    const missing = requiredEthNorm - bal;
    log(`⚡ Missing gas → sending TOP-UP: ${missing} ETH`);
    await topUp(missing + 0.000001);
  }

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: 0,
    data: contract.methods.fundTokenFor(user, tokenId).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`🔥 FUND done: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ======================= UPDATE IF ======================= */
async function updateIF(payment_id, txhash) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: payment_id,
        tx_hash: txhash
      })
    });

    log("↩️ update_order:", await r.text());
  } catch (e) {
    log("❌ update_order fail:", e.message);
  }
}

/* ======================= MAIN HANDLER ======================= */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const a = req.body?.action;

    if (a === "balance") {
      return res.json({ balance_eth: (await getBalanceEth()).toFixed(6) });
    }

    if (a === "mint") {
      const pid = req.body.payment_id;
      const user = req.body.user_address;
      const token = req.body.token_id;

      log(`🔥 MINT request: ${pid} token=${token}`);

      const tx = await executeFund(user, token);
      await updateIF(pid, tx);

      return res.json({ ok: true, tx_hash: tx });
    }

    return res.status(400).json({ ok:false, error:"unknown action" });

  } catch (e) {
    log("❌ ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}