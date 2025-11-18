 import Web3 from "web3";
import fetch from "node-fetch";

// ============ ENV ============
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

const web3 = new Web3(PROVIDER_URL);

// ============ ABI fundTokenFor ============
const ABI = [
  {
    type: "function",
    name: "fundTokenFor",
    inputs: [
      { type: "address", name: "user" },
      { type: "uint256", name: "tokenId" }
    ],
  },
];

// ============ LOG FUNCTION ============
async function sendLog(message) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message }),
    });
  } catch (e) {
    console.error("Log send fail:", e.message);
  }
}

const log = (...msg) => {
  const line = `[${new Date().toISOString()}] ${msg.join(" ")}`;
  console.log(line);
  sendLog(line);
};

// ============ GET RATE EUR/ETH ============
async function getEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    if (!j.ethereum.eur) throw new Error("Missing rate");
    log(`💱 1 ETH = ${j.ethereum.eur} €`);
    return j.ethereum.eur;
  } catch (e) {
    log("⚠️ Rate fallback = 2500 €/ETH");
    return 2500;
  }
}

// ============ GAS PRICE ============
async function getGas() {
  const g = await web3.eth.getGasPrice();
  log(`⛽ Gas (RPC): ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

// ============ READ ORDER FROM IF ============
async function loadOrder(order_id) {
  if (!INF_FREE_URL) throw new Error("INF_FREE_URL missing");
  const url = `${INF_FREE_URL}/chainuserdata/orders/${order_id}.json`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Order not found: ${order_id}`);

  const j = await r.json();
  log(`📦 Order ${order_id} → user=${j.user_addr}, token=${j.token_id}, amt=${j.amount}`);
  return j;
}

// ============ TOPUP (A) send ETH to admin address ============
async function sendTopup(amount_eth) {
  const valueWei = web3.utils.toWei(amount_eth.toString(), "ether");
  const gasPrice = await getGas();
  const nonce = await web3.eth.getTransactionCount(FROM);
  const chainId = await web3.eth.getChainId();

  const tx = {
    from: FROM,
    to: FROM,
    value: valueWei,
    gasPrice,
    gas: 21000,
    nonce,
    chainId,
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`⚡ TOPUP OK: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

// ============ MINT (B) send ETH to contract fundTokenFor ============
async function sendMint(user_addr, token_id, amount_eth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(amount_eth.toString(), "ether");
  const gasPrice = await getGas();

  const gasLimit = await contract.methods
    .fundTokenFor(user_addr, token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const nonce = await web3.eth.getTransactionCount(FROM);
  const chainId = await web3.eth.getChainId();

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce,
    chainId,
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`🔥 MINT OK: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

// ============ UPDATE IF ============
async function updateIF(order_id, tx_hash) {
  if (!INF_FREE_URL) return;
  const r = await fetch(`${INF_FREE_URL}/update_order.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ order_id, tx_hash }),
  });
  log(`↩️ IF updated: ${await r.text()}`);
}

// ============ BALANCE ============
async function getBalance() {
  const wei = await web3.eth.getBalance(FROM);
  const eth = web3.utils.fromWei(wei, "ether");
  return parseFloat(eth).toFixed(6);
}

// ============ MAIN HANDLER ============
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const type = req.body?.type || req.query?.type;

    // ========== BALANCE ==========
    if (type === "balance") {
      const b = await getBalance();
      return res.status(200).json({ balance_eth: b });
    }

    // ========== TOPUP ==========
    if (type === "topup") {
      const eur = parseFloat(req.body.amount_eur);
      const rate = await getEthRate();
      const eth = eur / rate;

      log(`⚡ TOPUP request: ${eur}€ = ${eth} ETH`);

      const tx = await sendTopup(eth);

      return res.status(200).json({
        ok: true,
        tx_hash: tx,
        sent_eth: eth
      });
    }

    // ========== MINT ==========
    if (type === "mint") {
      const order_id = req.body.order_id;
      let user       = req.body.user_addr;
      let token_id   = req.body.token_id;
      let eur        = req.body.amount_eur;

      if (!user || !token_id || !eur) {
        const data = await loadOrder(order_id);
        user = data.user_addr;
        token_id = data.token_id;
        eur = data.amount;
      }

      const rate = await getEthRate();
      const eth  = eur / rate;

      log(`🔥 MINT req: ${eur}€ = ${eth} ETH → token=${token_id}`);

      const tx = await sendMint(user, token_id, eth);
      await updateIF(order_id, tx);

      return res.status(200).json({
        ok: true,
        type: "mint",
        tx_hash: tx,
        sent_eth: eth,
        user_addr: user,
        token_id
      });
    }

    // ========== MULTI MINT ==========
    if (type === "multi") {
      const orders = req.body.orders ?? [];
      const rate = await getEthRate();

      const results = [];

      for (const ord of orders) {
        const { order_id, user_addr, token_id, amount_eur } = ord;

        const eth = amount_eur / rate;
        log(`🔥 MULTI → ${order_id}: ${amount_eur}€ = ${eth} ETH`);

        const tx = await sendMint(user_addr, token_id, eth);
        await updateIF(order_id, tx);

        results.push({
          order_id,
          tx_hash: tx,
          sent_eth: eth
        });
      }

      return res.status(200).json({ ok:true, results });
    }

    // ========== LOGS PROXY ==========
    if (type === "logs") {
      const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=read_log`);
      const txt = await r.text();
      res.setHeader("Content-Type","text/plain");
      return res.status(200).send(txt);
    }

    return res.status(400).json({ ok:false, error:"Unknown type" });

  } catch (err) {
    log("❌ ERROR:", err.message);
    return res.status(500).json({ ok:false, error: err.message });
  }
}