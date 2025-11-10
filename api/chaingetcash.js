import Web3 from "web3";
import fetch from "node-fetch";
import fs from "fs";

/* === ENV === */
const RPCS = [
  process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/YOUR_KEY",
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FROM = process.env.FROM_ADDRESS;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

/* === RPC AUTO INIT === */
let web3 = null;
for (const rpc of RPCS) {
  try {
    const w3 = new Web3(rpc);
    await w3.eth.getBlockNumber();
    web3 = w3;
    console.log(`✅ Using RPC: ${rpc}`);
    break;
  } catch (e) {
    console.log(`⚠️ RPC failed ${rpc}: ${e.message}`);
  }
}
if (!web3) throw new Error("No available RPC nodes");

/* === ABI === */
const ABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "originalId", "type": "uint256" }],
    "name": "mintCopy",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mintFee",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

/* === LOG HELPER === */
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

/* === mintFee autodetekcia === */
async function getMintFee(contract) {
  try {
    const feeWei = await contract.methods.mintFee().call();
    const feeEth = Number(web3.utils.fromWei(feeWei, "ether")) || 0.001;
    await log(`💰 Contract mintFee = ${feeEth} ETH`);
    return feeEth;
  } catch (e) {
    await log(`⚠️ mintFee() error: ${e.message}`);
    return 0.001;
  }
}

/* === UPDATE ORDER === */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  try {
    const res = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ order_id, tx_hash, user_addr }),
    });
    if (res.ok) await log(`📝 update_order ${order_id}`);
    else {
      await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order&order_id=${order_id}&tx_hash=${tx_hash}&user_addr=${user_addr}`);
      await log(`🟡 Fallback GET update_order ${order_id}`);
    }
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

/* === Mint transaction === */
async function mintCopyTx({ token_id, ethAmount, gasPrice, mintFeeEth }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueEth = ethAmount > 0 ? ethAmount : Math.max(mintFeeEth, 0.00005);
  const valueWei = web3.utils.toWei(String(valueEth), "ether");
  const gasLimit = await contract.methods.mintCopy(token_id).estimateGas({ from: FROM, value: valueWei });
  const balance = await web3.eth.getBalance(FROM);
  const gasCost = web3.utils.toBN(gasLimit).mul(web3.utils.toBN(gasPrice));

  if (web3.utils.toBN(balance).lt(web3.utils.toBN(valueWei).add(gasCost))) {
    await log(`⚠️ Skipping token ${token_id}: not enough ETH for gas+value`);
    return null;
  }

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
  try { fs.appendFileSync("/tmp/chaintx.log", `${Date.now()} ${receipt.transactionHash}\n`); } catch {}
  return receipt.transactionHash;
}

/* === MAIN HANDLER === */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "POST only" });

    await log("===== CHAINGETCASH START =====");

    const balanceEth = await getBalanceEth(FROM);
    await log(`💠 Balance ${FROM}: ${balanceEth.toFixed(6)} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balanceEth.toFixed(6)}`, {
      headers: { 'Referer': INF_FREE_URL + '/' }
    });

    const orders = req.body?.orders || [];
    if (!orders.length) {
      await log("ℹ️ No orders → only balance update");
      return res.json({ ok: true, balance_eth: balanceEth, funded_count: 0 });
    }

    const [rate, gas] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const contract = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let funded = 0, totalEur = 0;
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const token_id = Number(o.token_id);
      if (!token_id) continue;

      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      const eth = eur > 0 ? eur / rate : Math.max(mintFeeEth, 0.00005);
      totalEur += eur;

      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${eth.toFixed(6)} ETH)`);

      try {
        const txHash = await mintCopyTx({ token_id, ethAmount: eth, gasPrice: gas, mintFeeEth });
        if (txHash) {
          funded++;
          await markOrderPaid(o.paymentIntentId || String(token_id), txHash, o.user_address);
        }
      } catch (err) {
        await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);
      }
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 350));
    }

    await log(`📊 Náklady: Objednávky=${totalEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);

    // zapíš sumu objednávok do InfinityFree
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] 💶 Načítaná suma objednávok: ${totalEur.toFixed(2)} €`
      })
    });

    res.json({ ok: true, balance_eth: balanceEth, funded_count: funded });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}