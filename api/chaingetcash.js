import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PRIMARY_RPC   = process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/YOUR_KEY";
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

/* === WEB3 AUTO-RPC === */
let web3;
async function initWeb3() {
  if (web3) return web3;
  const rpcCandidates = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcCandidates) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();          // test, či RPC žije
      console.log(`✅ Using RPC: ${rpc}`);
      web3 = w3;
      return web3;
    } catch (e) {
      console.log(`⚠️ RPC failed ${rpc}: ${e.message}`);
    }
  }
  throw new Error("No available RPC nodes");
}

/* === ABI – len to, čo potrebujeme === */
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

/* === LOG do InfinityFree === */
async function sendLog(msg) {
  try {
    if (!INF_FREE_URL) return;
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "ChainversBot/1.0",
      },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`,
      }),
    });
  } catch (e) {
    console.error("Log transfer failed:", e.message);
  }
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === HELPERY === */
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

async function getGasPrice() {
  const w3 = await initWeb3();
  try {
    const gp = await w3.eth.getGasPrice();
    await log(`⛽ Gas: ${w3.utils.fromWei(gp, "gwei")} GWEI`);
    return gp;
  } catch (e) {
    await log(`⚠️ GasPrice error: ${e.message}`);
    return w3.utils.toWei("1", "gwei");
  }
}

async function getBalanceEth(addr) {
  const w3 = await initWeb3();
  try {
    const w = await w3.eth.getBalance(addr);
    return Number(w3.utils.fromWei(w, "ether"));
  } catch (e) {
    await log(`⚠️ getBalance fail: ${e.message}`);
    return 0;
  }
}

/* mintFee z kontraktu – ak fails, fallback 0.001 ETH */
async function getMintFee(contract) {
  const w3 = await initWeb3();
  try {
    const feeWei = await contract.methods.mintFee().call();
    const feeEth = Number(w3.utils.fromWei(feeWei, "ether"));
    await log(`💰 Contract mintFee = ${feeEth} ETH`);
    return feeEth;
  } catch (e) {
    await log(`⚠️ mintFee() error: ${e.message}`);
    return 0.001;
  }
}

/* Update objednávky v InfinityFree */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ order_id, tx_hash, user_addr }),
    });
    await log(`📝 update_order ${order_id}`);
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

/* Transakcia mintCopy */
async function mintCopyTx({ token_id, ethAmount, gasPrice, mintFeeEth }) {
  const w3 = await initWeb3();
  const contract = new w3.eth.Contract(ABI, CONTRACT);

  const valueEth = ethAmount > 0 ? ethAmount : (mintFeeEth > 0 ? mintFeeEth : 0.001);
  const valueWei = w3.utils.toWei(String(valueEth), "ether");

  const gasLimit = await contract.methods
    .mintCopy(token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(token_id).encodeABI(),
    gas: w3.utils.toHex(gasLimit),
    gasPrice: w3.utils.toHex(gasPrice),
    nonce: await w3.eth.getTransactionCount(FROM, "pending"),
    chainId: await w3.eth.getChainId(),
  };

  const signed = await w3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await w3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* === MAIN HANDLER === */
export default async function handler(req, res) {
  // CORS aby fetch z chainvers.free.nf fungoval
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    /* ========= 1) BALANCE ONLY – pri otvorení stránky / refresh ETH ========= */
    if (req.method === "GET" && req.query?.action === "balance") {
      await log("===== CHAINGETCASH BALANCE =====");
      const balEth = (await getBalanceEth(FROM)).toFixed(6);
      await log(`💠 Balance ${FROM}: ${balEth} ETH`);

      if (INF_FREE_URL) {
        await fetch(
          `${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(
            balEth
          )}`
        );
      }

      return res.status(200).json({ ok: true, balance: balEth });
    }

    /* ========= 2) MINT / DOBÍJANIE OBJEDNÁVOK ========= */
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    await log("===== CHAINGETCASH START =====");

    const balEthNum = await getBalanceEth(FROM);
    const balEthStr = balEthNum.toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEthStr} ETH`);

    if (INF_FREE_URL) {
      await fetch(
        `${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(
          balEthStr
        )}`
      );
    }

    const orders = req.body?.orders || [];
    if (!Array.isArray(orders) || !orders.length) {
      await log("ℹ️ Žiadne objednávky v tele – len balance update");
      return res
        .status(200)
        .json({ ok: true, balance_eth: balEthStr, funded_count: 0 });
    }

    const [rate, gas] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let funded = 0;
    let totalOrdersEur = 0;

    for (const o of orders) {
      const token_id = Number(o.token_id);
      if (!token_id) {
        await log(`⚠️ Neplatný token_id: ${JSON.stringify(o)}`);
        continue;
      }

      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      totalOrdersEur += eur;

      const eth =
        eur > 0
          ? eur / rate
          : mintFeeEth > 0
          ? mintFeeEth
          : 0.001;

      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${eth} ETH)`);

      try {
        const txHash = await mintCopyTx({
          token_id,
          ethAmount: eth,
          gasPrice: gas,
          mintFeeEth,
        });
        funded++;
        await markOrderPaid(
          o.paymentIntentId || String(token_id),
          txHash,
          o.user_address
        );
      } catch (err) {
        await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);
      }
    }

    await log(`📊 Náklady: Objednávky=${totalOrdersEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);

    return res
      .status(200)
      .json({ ok: true, balance_eth: balEthStr, funded_count: funded });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}