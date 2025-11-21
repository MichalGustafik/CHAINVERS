import Web3 from "web3";
import fetch from "node-fetch";

/* ============================================
   ENV
============================================ */
const RPCs = [
  process.env.PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "").replace(/\/$/, "");

/* ============================================
   RPC AUTO-SELECT
============================================ */
async function initWeb3() {
  for (const rpc of RPCs) {
    if (!rpc) continue;
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✓ Using RPC: ${rpc}`);
      return w3;
    } catch (e) {
      console.log(`✗ RPC fail ${rpc}`);
    }
  }
  throw new Error("No working RPC");
}
const web3 = await initWeb3();

/* ============================================
   ABI
============================================ */
const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

/* ============================================
   LOG → InfinityFree
============================================ */
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

const log = async (...a) => {
  const line = a.join(" ");
  console.log(line);
  await sendLog(line);
};

/* ============================================
   GAS + BALANCE
============================================ */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  await log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

async function getBalance() {
  const wei = await web3.eth.getBalance(FROM);
  return Number(web3.utils.fromWei(wei, "ether"));
}

/* ============================================
   ETH/EUR rate
============================================ */
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

/* ============================================
   UPDATE ORDER (InfinityFree)
============================================ */
async function updateIF(payment_id, tx_hash) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: payment_id,
        tx_hash: tx_hash
      })
    });
    await log(`↩ IF updated ${payment_id}:`, await r.text());
  } catch (e) {
    await log(`❌ update_order failed: ${e.message}`);
  }
}

/* ============================================
   MINT (fundTokenFor)
============================================ */
async function mintToken(user, token_id, valueEth) {
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

/* ============================================
   MAIN HANDLER
============================================ */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const action = req.body?.action;
    if (action !== "mint") {
      return res.status(400).json({ ok:false, error:"Unknown action" });
    }

    const payment_id = req.body.payment_id;
    const user       = req.body.user_address;
    const token      = Number(req.body.token_id);
    const eur        = Number(req.body.amount_eur ?? 0);

    if (!payment_id || !user || !token) {
      return res.status(400).json({ ok:false, error:"Missing fields" });
    }

    await log(`🔥 MINT request: ${payment_id} token=${token}`);

    // ETH výpočet
    const rate = await getRate();
    let valueEth = eur > 0 ? eur / rate : 0;   // free mint → 0 ETH

    await log(`→ EUR=${eur} → ETH=${valueEth}`);

    // MIN = 0 (NEPRIDÁVAME žiadny limit!)
    if (valueEth < 0) valueEth = 0;

    // vykonaj MINT
    const tx = await mintToken(user, token, valueEth);

    // updatni InfinityFree
    await updateIF(payment_id, tx);

    return res.status(200).json({
      ok: true,
      payment_id,
      tx_hash: tx,
      sent_eth: valueEth,
      user_address: user,
      token_id: token
    });

  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok:false, error: e.message });
  }
}