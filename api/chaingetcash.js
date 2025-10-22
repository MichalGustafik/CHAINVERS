import Web3 from "web3";
import fetch from "node-fetch";

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// ===== ENV VARS =====
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FROM = process.env.FROM_ADDRESS;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY = process.env.INFURA_API_KEY;
const INF_FREE_URL = process.env.INF_FREE_URL;

// ===== ABI =====
const ABI = [
  {
    type: "function",
    name: "fundTokenFor",
    inputs: [
      { type: "address", name: "user" },
      { type: "uint256", name: "tokenId" },
    ],
  },
];

export const config = { api: { bodyParser: true } };

// 💱 1️⃣ získa kurz ETH/EUR (CoinGecko)
async function getEurEthRate() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j = await r.json();
    const rate = j.ethereum.eur;
    log(`💱 1 ETH = ${rate} EUR`);
    return rate;
  } catch (e) {
    log("⚠️ CoinGecko fail, fallback 2500 EUR");
    return 2500;
  }
}

// ⛽ 2️⃣ gas price z Infura API alebo fallback
async function getGasPrice() {
  try {
    const r = await fetch(`https://gas.api.infura.io/v3/${INFURA_API_KEY}`);
    const j = await r.json();
    const gwei = j?.data?.fast?.maxFeePerGas ?? null;
    if (gwei) {
      const wei = web3.utils.toWei(Number(gwei).toFixed(0), "gwei");
      log(`⛽ Gas (Infura): ${gwei} GWEI`);
      return wei;
    }
  } catch (e) {
    log("⚠️ Infura gas fallback:", e.message);
  }
  const gasPrice = await web3.eth.getGasPrice();
  log(`⛽ Gas (RPC): ${web3.utils.fromWei(gasPrice, "gwei")} GWEI`);
  return gasPrice;
}

// 📦 3️⃣ načítaj orders.json z InfinityFree
async function getOrderData(order_id) {
  const url = `${INF_FREE_URL}/chainuserdata/orders/${order_id}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Order not found (${order_id})`);
  const j = await r.json();
  log(`📦 order ${order_id} → token ${j.token_id}, user ${j.user_addr}`);
  return j;
}

// 💸 4️⃣ pošli ETH na NFT kontrakt
async function sendEthToNFT({ user_addr, token_id, ethAmount }) {
  const contract = new web3.eth.Contract(ABI);
  const data = contract.methods.fundTokenFor(user_addr, token_id).encodeABI();

  const gasPrice = await getGasPrice();
  const gasLimit = await web3.eth.estimateGas({
    from: FROM,
    to: CONTRACT,
    data,
    value: web3.utils.toWei(ethAmount.toString(), "ether"),
  });

  const tx = {
    from: FROM,
    to: CONTRACT,
    data,
    value: web3.utils.toWei(ethAmount.toString(), "ether"),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM),
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`✅ TX done: ${receipt.transactionHash}`);
  return receipt;
}

// 📝 5️⃣ zapíš späť do orders.json (InfinityFree)
async function markOrderFunded(order_id, tx_hash) {
  const updateUrl = `${INF_FREE_URL}/update_order.php`; // PHP skript na InfinityFree
  const body = new URLSearchParams({
    order_id,
    tx_hash,
  });
  const resp = await fetch(updateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const txt = await resp.text();
  log(`📝 Updated order on server: ${txt}`);
  return txt;
}

// 🧩 6️⃣ hlavný handler
export default async function handler(req, res) {
  try {
    log("===== CHAINGETCASH START =====");

    const order_id = req.body?.order_id || req.query?.order_id;
    if (!order_id) return res.status(400).json({ error: "Missing order_id" });

    const order = await getOrderData(order_id);
    const { user_addr, token_id, amount_eur } = order;

    if (!user_addr || !token_id || !amount_eur)
      return res.status(400).json({ error: "Incomplete order data" });

    const eurPerEth = await getEurEthRate();
    const ethAmount = Number(amount_eur) / eurPerEth;
    log(`💰 ${amount_eur} € = ${ethAmount} ETH`);

    const receipt = await sendEthToNFT({ user_addr, token_id, ethAmount });

    // ✅ aktualizácia orderu po úspechu
    await markOrderFunded(order_id, receipt.transactionHash);

    return res.status(200).json({
      ok: true,
      order_id,
      token_id,
      user_addr,
      sent_eth: ethAmount,
      tx_hash: receipt.transactionHash,
    });
  } catch (err) {
    log("❌ ERROR:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
