import Web3 from "web3";
import fetch from "node-fetch";

/* ======================= ENV ======================= */
const RPCs = [
  process.env.PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "").replace(/\/$/, "");

/* ======================= RPC AUTO ======================= */
async function initWeb3() {
  for (const rpc of RPCs) {
    if (!rpc) continue;
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✓ Using RPC: ${rpc}`);
      return w3;
    } catch {}
  }
  throw new Error("No working RPC");
}
const web3 = await initWeb3();

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
  } catch {}
}
const log = async (...t) => {
  const m = t.join(" ");
  console.log(m);
  await sendLog(m);
};

/* ======================= ETH RATE ======================= */
async function getRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();

    const rate = j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} €`);
    return rate || 2500;
  } catch {
    await log("⚠️ CoinGecko fallback 2500");
    return 2500;
  }
}

/* ======================= GAS ======================= */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  await log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

/* ======================= UPDATE IF ======================= */
async function updateIF(order_id, tx_hash) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id,
        tx_hash
      })
    });

    await log(`↩ IF updated: ${order_id} ::`, await r.text());
  } catch (e) {
    await log(`❌ update_order failed: ${e.message}`);
  }
}

/* ======================= MINT ======================= */
async function mint(user, token_id, valueEth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const gasPrice = await getGas();
  const valueWei = web3.utils.toWei(String(valueEth), "ether");

  const gasLimit = await contract.methods
    .fundTokenFor(user, token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.fundTokenFor(user, token_id).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  await log(`🔥 MINT TX: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ======================= HANDLER ======================= */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    if (req.body?.action !== "mint") {
      return res.status(400).json({ ok:false, error:"Unknown action" });
    }

    const payment_id = req.body.payment_id;
    const user       = req.body.user_address;
    const token      = Number(req.body.token_id);
    const eur        = Number(req.body.amount_eur ?? 0);

    await log(`🔥 MINT request: ${payment_id} token=${token}`);

    // Rate je len pre platené objednávky
    const rate = await getRate();

    let valueEth = eur > 0 ? eur / rate : 0;

    await log(`→ EUR=${eur} → ETH=${valueEth}`);

    /* ======================================
       💥 FREE MINT FIX (FINAL)
       0 € = 1 wei (0.000000000000000001 ETH)
    ====================================== */
    if (eur <= 0) {
      valueEth = 0.000000000000000001;
      await log(`🟪 FREE MINT MODE → value = 1 wei`);
    }

    const tx = await mint(user, token, valueEth);

    await updateIF(payment_id, tx);

    return res.status(200).json({
      ok: true,
      payment_id,
      token_id: token,
      user_address: user,
      sent_eth: valueEth,
      tx_hash: tx
    });

  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok:false, error: e.message });
  }
}