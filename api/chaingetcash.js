import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PRIMARY_RPC   = process.env.PROVIDER_URL;                // napr. Infura Base mainnet
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

const MIN_ETH_FALLBACK = 0.001; // minimálny poplatok pre 0€ objednávky

/* === RPC autodetekcia === */
async function initWeb3() {
  const rpcList = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcList) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✅ Using RPC: ${rpc}`);
      return w3;
    } catch (e) {
      console.log(`⚠️ RPC fail ${rpc}: ${e.message}`);
    }
  }
  throw new Error("No available RPC node");
}
const web3 = await initWeb3();

/* === ABI (len mintCopy + mintFee) === */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "mintFee",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view"
  },
];

/* === API config === */
export const config = { api: { bodyParser: true } };

/* === LOG → IF === */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ChainversBot/1.0",
      },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`,
      }),
    });
  } catch (e) {
    console.log("log send error:", e.message);
  }
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === HELPERS === */
async function getEurEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate || 2500;
  } catch (e) {
    await log("⚠️ CoinGecko fail → 2500");
    return 2500;
  }
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

async function getBalanceEth(addr) {
  try {
    const w = await web3.eth.getBalance(addr);
    const eth = Number(web3.utils.fromWei(w, "ether"));
    await log(`💠 Balance ${addr}: ${eth.toFixed(6)} ETH`);
    return eth;
  } catch (e) {
    await log(`⚠️ getBalance fail: ${e.message}`);
    return 0;
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
    return 0; // fallback → použijeme MIN_ETH_FALLBACK
  }
}

/* === update_order na IF === */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id, tx_hash, user_addr }),
    });
    await log(`📝 update_order ${order_id}`);
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

/* === mintCopy tx === */
async function mintCopyTx({ token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(ethAmount), "ether");

  const gasLimit = await contract.methods
    .mintCopy(token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to:   CONTRACT,
    value: valueWei,
    data:  contract.methods.mintCopy(token_id).encodeABI(),
    gas:      web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce:    await web3.eth.getTransactionCount(FROM, "pending"),
    chainId:  await web3.eth.getChainId(),
  };

  const signed   = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt  = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  const txHash   = receipt.transactionHash;
  await log(`✅ TX: ${txHash}`);
  return txHash;
}

/* === MAIN HANDLER === */
export default async function handler(req, res) {
  try {
    /* --- GET ?action=balance → len zistí a vráti ETH zostatok --- */
    if (req.method === "GET" && req.query?.action === "balance") {
      await log("===== CHAINGETCASH BALANCE CHECK =====");
      const balEth = await getBalanceEth(FROM);

      // uložíme do IF
      try {
        await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(balEth)}`);
      } catch (e) {
        await log(`⚠️ balance write fail: ${e.message}`);
      }

      return res.status(200).json({ ok: true, balance: balEth });
    }

    /* --- POST: hlavný mint/dobíjací flow --- */
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST or GET?action=balance" });
    }

    await log("===== CHAINGETCASH START =====");

    // 1) balance + zapíš do IF
    const balEth = await getBalanceEth(FROM);
    try {
      await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(balEth)}`);
    } catch (e) {
      await log(`⚠️ balance write fail: ${e.message}`);
    }

    const body = req.body || {};
    const orders = body.orders || [];

    if (!orders.length) {
      await log("ℹ️ Žiadne objednávky v tele – len balance update");
      return res.status(200).json({ ok: true, balance_eth: balEth, funded_count: 0 });
    }

    // 2) kurz + gas + mintFee
    const [rate, gasPrice] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const contract = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let funded = 0;
    let totalEur = 0;

    for (const o of orders) {
      const token_id = Number(o.token_id);
      if (!token_id) {
        await log(`⚠️ Neplatný token_id: ${JSON.stringify(o)}`);
        continue;
      }

      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      totalEur += isNaN(eur) ? 0 : eur;

      let ethAmount = 0;
      if (eur > 0) {
        ethAmount = eur / rate;
      } else {
        ethAmount = mintFeeEth > 0 ? mintFeeEth : MIN_ETH_FALLBACK;
      }

      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${ethAmount} ETH)`);

      try {
        const txHash = await mintCopyTx({ token_id, ethAmount, gasPrice });
        funded++;
        await markOrderPaid(o.paymentIntentId || String(token_id), txHash, o.user_address);
      } catch (err) {
        await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);
      }
    }

    await log(`📊 Náklady: Objednávky=${totalEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);

    return res.status(200).json({
      ok: true,
      balance_eth: balEth,
      funded_count: funded,
      total_eur: totalEur,
    });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}