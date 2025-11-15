import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PROVIDER_URL   = process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FROM           = process.env.FROM_ADDRESS;
const CONTRACT       = process.env.CONTRACT_ADDRESS;
const INF_FREE_RAW   = process.env.INF_FREE_URL || "https://chainvers.free.nf";
const INF_FREE_URL   = INF_FREE_RAW.replace(/\/$/, "");

/* === WEB3 === */
const web3 = new Web3(PROVIDER_URL);

/* === ABI (mintCopy + mintFee) === */
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
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
];

export const config = { api: { bodyParser: true } };

/* === LOG → accptpay.php?action=save_log === */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`,
      }),
    });
  } catch {}
}

const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === HELPERS === */
async function getBalanceEth(addr) {
  const w = await web3.eth.getBalance(addr);
  return Number(web3.utils.fromWei(w, "ether"));
}

async function getGasPrice() {
  try {
    const gp = await web3.eth.getGasPrice();
    await log(`⛽ Gas: ${web3.utils.fromWei(gp, "gwei")} GWEI`);
    return gp;
  } catch (e) {
    await log(`⚠️ GasPrice error: ${e.message}`);
    return web3.utils.toWei("1", "gwei");
  }
}

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
    await log("⚠️ CoinGecko fail → 2500");
    return 2500;
  }
}

async function getMintFee(contract) {
  try {
    const feeWei = await contract.methods.mintFee().call();
    const feeEth = Number(web3.utils.fromWei(feeWei, "ether"));
    await log(`💰 Contract mintFee = ${feeEth} ETH`);
    return feeEth;
  } catch (e) {
    await log(`⚠️ mintFee() error: ${e.message}`);
    return 0.001;
  }
}

/* === TX mintCopy === */
async function mintCopyTx({ token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(ethAmount), "ether");

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

/* === UPDATE ORDER NA IF (variant 3: order_id + payment_id + token_id) === */
async function markOrderPaid({ payment_id, token_id, user_addr, tx_hash }) {
  const body = {
    order_id: payment_id || String(token_id),
    payment_id: payment_id || null,
    token_id,
    user_addr,
    tx_hash,
  };

  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    await log(`📝 update_order resp: ${txt}`);
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

/* === HANDLER === */
export default async function handler(req, res) {
  try {
    /* GET ?action=balance → len získať zostatok + zapísať do IF */
    if (req.method === "GET" && req.query?.action === "balance") {
      await log("===== CHAINGETCASH BALANCE CHECK =====");
      const balEth = (await getBalanceEth(FROM)).toFixed(6);
      await log(`💠 Balance ${FROM}: ${balEth} ETH`);

      // zapíš aj do IF (accptpay.php?action=balance)
      try {
        await fetch(
          `${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(
            balEth
          )}`
        );
      } catch {}

      return res.status(200).json({ ok: true, balance: balEth });
    }

    /* POST → mintovanie / cash */
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    await log("===== CHAINGETCASH START =====");

    const balEth = (await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);

    const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (!orders.length) {
      await log("ℹ️ Žiadne objednávky v body – len balance update");
      return res.status(200).json({ ok: true, balance_eth: balEth, funded: 0 });
    }

    const [rate, gasPrice] = await Promise.all([
      getEurEthRate(),
      getGasPrice(),
    ]);
    const contract = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let funded = 0;
    let sumEur = 0;

    for (const o of orders) {
      const token_id = Number(o.token_id);
      const payment_id = o.payment_id ? String(o.payment_id) : "";
      const user_addr = o.user_address;

      if (!token_id || !user_addr) {
        await log(
          `⚠️ Neplatná objednávka: ${JSON.stringify({
            token_id,
            payment_id,
            user_addr,
          })}`
        );
        continue;
      }

      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      sumEur += isNaN(eur) ? 0 : eur;

      // Ak objednávka má sumu > 0 → prepočítaj z EUR
      // Ak 0 → použijeme mintFeeEth alebo minimom 0.001
      let ethAmount = 0;
      if (eur > 0) {
        ethAmount = eur / rate;
      } else {
        ethAmount = mintFeeEth > 0 ? mintFeeEth : 0.001;
      }

      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${ethAmount} ETH)`);

      try {
        const txHash = await mintCopyTx({ token_id, ethAmount, gasPrice });
        funded++;
        await markOrderPaid({
          payment_id,
          token_id,
          user_addr,
          tx_hash: txHash,
        });
      } catch (e) {
        await log(`⚠️ MintCopy ${token_id} failed: ${e.message}`);
      }
    }

    await log(`📊 Náklady: Objednávky=${sumEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);

    return res
      .status(200)
      .json({ ok: true, balance_eth: balEth, funded_count: funded });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}