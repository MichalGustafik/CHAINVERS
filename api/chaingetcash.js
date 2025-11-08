import Web3 from "web3";
import fetch from "node-fetch";

const web3 = new Web3(process.env.PROVIDER_URL);

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FROM        = process.env.FROM_ADDRESS;
const CONTRACT    = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL= process.env.INF_FREE_URL?.replace(/\/$/, "") || "https://chainvers.free.nf";

const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

export const config = { api: { bodyParser: true } };

async function sendLog(message) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${message}` })
    });
  } catch {}
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

async function getEurEthRate() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j = await r.json();
    const rate = j?.ethereum?.eur || 2500;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate;
  } catch {
    await log("⚠️ CoinGecko fail, fallback 2500");
    return 2500;
  }
}

async function getGasPrice() {
  const gp = await web3.eth.getGasPrice();
  await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp, "gwei")} GWEI`);
  return gp;
}

async function getChainBalanceEth(address) {
  const w = await web3.eth.getBalance(address);
  return Number(web3.utils.fromWei(w, "ether"));
}

async function sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const weiValue = web3.utils.toWei(String(ethAmount), "ether");
  const gasLimit = await contract.methods
    .fundTokenFor(user_addr, token_id)
    .estimateGas({ from: FROM, value: weiValue });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: weiValue,
    data: contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId(),
  };

  await log(`▶️ TX → fundTokenFor(${user_addr}, ${token_id}) ${ethAmount} ETH`);
  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "POST only" });

    await log("===== CHAINGETCASH START =====");

    const { user_addr, token_id, amount_eur } = req.body;
    if (!user_addr || !token_id)
      return res.status(400).json({ ok: false, error: "Missing user or token" });

    const [rate, gas] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const bal = await getChainBalanceEth(FROM);
    await log(`💠 Balance ${FROM}: ${bal} ETH`);

    const ethAmount = amount_eur ? Number(amount_eur) / rate : 0.0001;
    const r = await sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice: gas });

    // spätný zápis do InfinityFree
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: token_id,
        tx_hash: r.transactionHash,
        user_addr,
      }),
    });

    await log(`✅ FUND DONE for ${token_id}`);
    return res.json({ ok: true, tx_hash: r.transactionHash, funded: token_id });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}