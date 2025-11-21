import Web3 from "web3";
import fetch from "node-fetch";

/* ============================================================
   ENV
============================================================ */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

const RPC_FALLBACKS = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

/* ============================================================
   INIT WEB3 WITH FALLBACKS
============================================================ */
async function getWeb3() {
  for (const rpc of RPC_FALLBACKS) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✅ Using RPC:", rpc);
      return w3;
    } catch {}
  }
  throw new Error("No working RPC");
}
const web3 = await getWeb3();

/* ============================================================
   ABI – fundovanie NFT
============================================================ */
const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

/* ============================================================
   LOG DO INFINITYFREE
============================================================ */
async function sendLog(m) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${m}`
      })
    });
  } catch {}
}
const log = (...m) => {
  const line = m.join(" ");
  console.log(line);
  sendLog(line);
};

/* ============================================================
   GET ETH RATE
============================================================ */
async function getEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    log(`💱 1 ETH = ${j.ethereum.eur} €`);
    return j.ethereum.eur;
  } catch {
    log("⚠️ CoinGecko fail → fallback 2500");
    return 2500;
  }
}

/* ============================================================
   GAS PRICE
============================================================ */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

/* ============================================================
   AUTO-DOPLATENIE ETH AK CHÝBA
============================================================ */
async function ensureEnoughFunds(valueWei, gasLimit, gasPrice) {
  const gasCostWei = BigInt(gasLimit) * BigInt(gasPrice);
  const neededWei = gasCostWei + BigInt(valueWei);
  const currentWei = BigInt(await web3.eth.getBalance(FROM));

  if (currentWei >= neededWei) {
    log("✔️ Peňaženka má dostatok ETH");
    return;
  }

  const missingWei = neededWei - currentWei;
  const missingEth = web3.utils.fromWei(missingWei.toString(), "ether");

  log(`⚡ Chýba ${missingEth} ETH → doplácam...`);

  const tx = {
    from: FROM,
    to: FROM,
    value: missingWei.toString(),
    gas: 21000,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`✔️ Doplatok hotový: +${missingEth} ETH`);
}

/* ============================================================
   ODOŠLI ETH NA NFT (GAS² systém)
============================================================ */
async function fund(user, tokenId, amountEth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const gasPrice = await getGas();

  // ETH podľa objednávky
  let valueWei = BigInt(web3.utils.toWei(amountEth.toString(), "ether"));

  // GAS² → pre 0 € objednávky
  if (amountEth === 0) {
    const gasLimit = 90000n;
    const gasCostWei = BigInt(gasPrice) * gasLimit;
    valueWei = gasCostWei * 2n;

    log(`⚡ GAS² režim → value = ${web3.utils.fromWei(valueWei.toString(), "ether")} ETH`);
  }

  const gasLimit = await contract.methods
    .fundTokenFor(user, tokenId)
    .estimateGas({ from: FROM, value: valueWei.toString() });

  await ensureEnoughFunds(valueWei, gasLimit, gasPrice);

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei.toString(),
    data: contract.methods.fundTokenFor(user, tokenId).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`🔥 FUND DONE: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ============================================================
   UPDATE IF
============================================================ */
async function updateIF(payment_id, tx_hash) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        payment_id,
        tx_hash
      })
    });
    log(`↩️ update_order: ${await r.text()}`);
  } catch (e) {
    log("❌ update_order failed:", e.message);
  }
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const a = req.body.action;

    if (a === "mint") {
      const payment_id = req.body.payment_id;
      const user       = req.body.user_address;
      const token      = req.body.token_id;
      const eurAmount  = parseFloat(req.body.amount_eur);

      const rate = await getEthRate();
      let eth = eurAmount > 0 ? eurAmount / rate : 0; // GAS² pre 0 €

      log(`🔥 MINT: ${payment_id} → token ${token} → EUR=${eurAmount} → ETH=${eth}`);

      const tx = await fund(user, token, eth);
      await updateIF(payment_id, tx);

      return res.status(200).json({
        ok: true,
        tx_hash: tx,
        sent_eth: eth
      });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch (e) {
    log("❌ ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}