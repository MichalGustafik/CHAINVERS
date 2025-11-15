import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const RPC = process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FROM = process.env.FROM_ADDRESS;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "").replace(/\/$/, "");

/* === Web3 === */
const web3 = new Web3(RPC);

/* === ABI === */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
  },
  {
    type: "function",
    name: "mintFee",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  }
];

/* === API === */
export const config = { api: { bodyParser: true } };

/* === Logy → InfinityFree === */
async function sendLog(msg) {
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
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === Helpers === */
async function getEurEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate || 2500;
  } catch {
    await log("⚠️ CoinGecko fallback 2500");
    return 2500;
  }
}

async function getGasPrice() {
  try {
    const gp = await web3.eth.getGasPrice();
    await log(`⛽ Gas: ${web3.utils.fromWei(gp, "gwei")} GWEI`);
    return gp;
  } catch {
    return web3.utils.toWei("1", "gwei");
  }
}

async function getBalanceEth() {
  const w = await web3.eth.getBalance(FROM);
  const eth = Number(web3.utils.fromWei(w, "ether"));
  await log(`💠 Balance ${FROM}: ${eth.toFixed(6)} ETH`);
  await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${eth}`);
  return eth;
}

/* === Mintovanie === */
async function mintCopyTx({ token_id, valueEth, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(valueEth), "ether");

  const gasLimit = await contract.methods
    .mintCopy(token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId(),
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);

  return receipt.transactionHash;
}

/* === Update objednávky === */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ order_id, tx_hash, user_addr })
  });
  await log(`📝 update_order ${order_id}`);
}

/* === MAIN === */
export default async function handler(req, res) {
  try {
    await log("===== CHAINGETCASH START =====");

    const orders = req.body?.orders || [];
    if (!orders.length) return res.json({ ok: true, funded_count: 0 });

    await getBalanceEth();
    const rate = await getEurEthRate();
    const gasPrice = await getGasPrice();

    const contract = new web3.eth.Contract(ABI, CONTRACT);
    let mintFeeEth = 0;

    try {
      const feeWei = await contract.methods.mintFee().call();
      mintFeeEth = Number(web3.utils.fromWei(feeWei, "ether"));
      await log(`💰 Contract mintFee = ${mintFeeEth} ETH`);
    } catch {
      mintFeeEth = 0.001; // fallback ako 11. nov
    }

    let funded = 0;

    for (const o of orders) {
      const token = Number(o.token_id);
      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      const valueEth = eur > 0 ? eur / rate : mintFeeEth;

      await log(`→ Token ${token}: ${eur.toFixed(2)}€ (${valueEth} ETH)`);

      try {
        const tx = await mintCopyTx({ token_id: token, valueEth, gasPrice });
        funded++;
        await markOrderPaid(o.paymentIntentId || String(token), tx, o.user_address);
      } catch (err) {
        await log(`⚠️ MintCopy ${token} failed: ${err.message}`);
      }
    }

    await log(`📊 Mint hotový – ${funded}`);
    res.json({ ok: true, funded_count: funded });

  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}