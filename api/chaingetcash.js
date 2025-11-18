import Web3 from 'web3';
import fetch from 'node-fetch';

/* ============================================================
   ENV VARS
   ============================================================ */

const PROVIDER_URL   = process.env.PROVIDER_URL;     // Base/ETH RPC
const PRIVATE_KEY    = process.env.PRIVATE_KEY;      // Admin PK
const FROM           = process.env.FROM_ADDRESS;     // Admin wallet
const CONTRACT       = process.env.CONTRACT_ADDRESS; // Mint contract
const INF_FREE_URL   = process.env.INF_FREE_URL;     // https://chainvers.free.nf

const web3 = new Web3(PROVIDER_URL);

/* ============================================================
   ABI – musí obsahovať len funkciu fundTokenFor()
   ============================================================ */
const ABI = [
  {
    "type": "function",
    "name": "fundTokenFor",
    "inputs": [
      { "type": "address", "name": "user" },
      { "type": "uint256", "name": "tokenId" }
    ]
  }
];

/* ============================================================
   RAW LOG → accptpay.php?action=save_log
   ============================================================ */
async function sendLog(message) {
  try {
    if (!INF_FREE_URL) return;
    const url = `${INF_FREE_URL}/accptpay.php?action=save_log`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message })
    });
  } catch (e) {
    console.error("Log send failed:", e.message);
  }
}

const log = (...args) => {
  const line = `[${new Date().toISOString()}] ` + args.join(" ");
  console.log(line);
  sendLog(line);
};

/* ============================================================
   1) ETH/EUR RATE (CoinGecko fallback)
   ============================================================ */
async function getEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    if (!rate) throw new Error("missing rate");

    log(`💱 1 ETH = ${rate} EUR`);
    return rate;
  } catch {
    log("⚠️ Rate fallback to 2500");
    return 2500;
  }
}

/* ============================================================
   2) GAS PRICE
   ============================================================ */
async function getGasPrice() {
  try {
    const p = await web3.eth.getGasPrice();
    log(`⛽ Gas: ${web3.utils.fromWei(p, "gwei")} GWEI`);
    return p;
  } catch {
    return web3.utils.toWei("25", "gwei");
  }
}

/* ============================================================
   3) FETCH ORDER FROM INF. FREE
   ============================================================ */
async function getOrder(order_id) {
  const url = `${INF_FREE_URL}/chainuserdata/orders/${order_id}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("order not found");

  const j = await r.json();

  log(`📦 Order ${order_id}: user=${j.user_address}, token=${j.token_id}, amount=${j.amount}`);

  return j;
}

/* ============================================================
   4) SEND ETH TO NFT
   ============================================================ */
async function sendEth({ user_addr, token_id, ethAmount }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const valueWei = web3.utils.toWei(ethAmount.toString(), "ether");
  const gasPrice = await getGasPrice();

  const gasLimit = await contract.methods
    .fundTokenFor(user_addr, token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    data: contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    value: valueWei,
    gas: gasLimit,
    gasPrice
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`✅ TX SENT: ${receipt.transactionHash}`);
  return receipt;
}

/* ============================================================
   5) UPDATE ORDER ON INFINITYFREE (FINAL)
   ============================================================ */
async function updateOrder(order_id, tx_hash, eth_sent) {
  if (!INF_FREE_URL) return;

  const url = `${INF_FREE_URL}/accptpay.php?action=update_from_vercel`;

  const body = new URLSearchParams({
    order_id,
    tx_hash,
    eth_sent
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const txt = await resp.text();
  log(`📝 update_from_vercel = ${txt}`);
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */
export default async function handler(req, res) {
  try {
    log("===== CHAINGETCASH START =====");

    const order_id = req.body?.order_id || req.query?.order_id;
    const amount_eur = req.body?.amount_eur;

    if (!order_id) {
      return res.status(400).json({ ok: false, error: "missing order_id" });
    }

    // read order data
    const order = await getOrder(order_id);

    const user_addr = order.user_address;
    const token_id  = order.token_id;
    const eur       = amount_eur ?? order.amount;

    if (!user_addr || !token_id) {
      throw new Error("incomplete order data");
    }

    const rate = await getEthRate();
    const eth = eur / rate;

    log(`💰 ${eur}€ → ${eth} ETH`);
    
    const receipt = await sendEth({
      user_addr,
      token_id,
      ethAmount: eth
    });

    await updateOrder(order_id, receipt.transactionHash, eth);

    return res.status(200).json({
      ok: true,
      order_id,
      token_id,
      user_addr,
      sent_eth: eth,
      tx_hash: receipt.transactionHash
    });

  } catch (err) {
    log("❌ ERROR:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
