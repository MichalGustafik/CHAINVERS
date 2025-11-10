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

/* === RPC AUTO-SELECTION === */
async function initWeb3() {
  const rpcCandidates = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcCandidates) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✅ Using RPC: ${rpc}`);
      return w3;
    } catch (e) {
      console.log(`⚠️ RPC failed ${rpc}: ${e.message}`);
    }
  }
  throw new Error("No available RPC nodes");
}
const web3 = await initWeb3();

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
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
];

/* === LOGGING === */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${msg}` }),
    });
  } catch {}
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === HELPERS === */
async function getEurEthRate() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
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
    return Number(web3.utils.fromWei(w, "ether"));
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
    return 0.001;
  }
}

async function markOrderPaid(order_id, tx_hash, user_addr) {
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

/* === SMART MINTER (dynamic gas, mintFee, fallback) === */
const MIN_FALLBACK_ETH = 0.00005;

async function mintCopyTx({ token_id, eurAmount, rate, gasPrice, mintFeeEth }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  let valueEth = 0;

  if (Number(eurAmount) > 0) valueEth = Number(eurAmount) / rate;
  else valueEth = (mintFeeEth && mintFeeEth > 0) ? mintFeeEth : MIN_FALLBACK_ETH;

  let valueWei = web3.utils.toBN(web3.utils.toWei(String(valueEth), 'ether'));
  let gasLimit;

  try {
    gasLimit = await contract.methods.mintCopy(token_id).estimateGas({ from: FROM, value: valueWei });
  } catch (e) {
    await log(`⚠️ estimateGas fail token ${token_id}: ${e.message}`);
    return null;
  }

  const gasCost = web3.utils.toBN(gasLimit).mul(web3.utils.toBN(gasPrice));
  const balance = web3.utils.toBN(await web3.eth.getBalance(FROM));

  if (balance.lt(gasCost.add(valueWei))) {
    const fallbackWei = web3.utils.toBN(web3.utils.toWei(String(MIN_FALLBACK_ETH), "ether"));
    if (fallbackWei.lt(balance)) {
      valueWei = fallbackWei;
      await log(`⚠️ Low balance → using fallback ${web3.utils.fromWei(valueWei)} ETH`);
    } else {
      await log(`⚠️ Not enough even for fallback token ${token_id}`);
      return null;
    }
  }

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei.toString(),
    data: contract.methods.mintCopy(token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash} token=${token_id} value=${web3.utils.fromWei(valueWei)} ETH`);
  return receipt.transactionHash;
}

/* === MAIN HANDLER === */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "POST only" });

    await log("===== CHAINGETCASH START =====");

    const balEth = (await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`);

    const orders = req.body?.orders || [];
    if (!orders.length) {
      await log("ℹ️ Žiadne objednávky – len update balance");
      return res.json({ ok: true, balance_eth: balEth, funded_count: 0 });
    }

    const [rate, gas] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const contract = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let totalEur = 0, funded = 0;
    for (const o of orders) {
      const token_id = Number(o.token_id);
      if (!token_id) continue;
      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      totalEur += eur;
      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${(eur>0?(eur/rate):mintFeeEth).toFixed(6)} ETH)`);

      const txHash = await mintCopyTx({ token_id, eurAmount: eur, rate, gasPrice: gas, mintFeeEth });
      if (txHash) {
        funded++;
        await markOrderPaid(o.paymentIntentId || String(token_id), txHash, o.user_address);
      }
    }

    await log(`📊 Náklady: Objednávky=${totalEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);
    res.json({ ok: true, balance_eth: balEth, funded_count: funded });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}