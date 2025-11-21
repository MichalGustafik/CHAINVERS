import Web3 from "web3";
import fetch from "node-fetch";

/* ============================================================
   ENV
============================================================ */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL || "";

/* ============================================================
   RPC FALLBACKS
============================================================ */
const RPC_FALLBACKS = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

/* ============================================================
   INIT WEB3
============================================================ */
async function getWeb3() {
  for (const rpc of RPC_FALLBACKS) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✅ Using RPC:", rpc);
      return w3;
    } catch (e) {
      console.log("⚠️ RPC fail:", rpc);
    }
  }
  throw new Error("No RPC working");
}
const web3 = await getWeb3();

/* ============================================================
   ABI
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
async function sendLog(message) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${message}`
      }),
    });
  } catch (e) {}
}
const log = (...msg) => {
  const line = msg.join(" ");
  console.log(line);
  sendLog(line);
};

/* ============================================================
   ETH RATE
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
    log("⚠️ CoinGecko fail → fallback 2500 €/ETH");
    return 2500;
  }
}

/* ============================================================
   GAS
============================================================ */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

/* ============================================================
   AUTO-DOPLATENIE — doplatí iba toľko, koľko chýba
============================================================ */
async function autoTopup(requiredWei, gasLimit, gasPrice) {
  const gasCostWei = BigInt(gasLimit) * BigInt(gasPrice);
  const neededWei = gasCostWei + BigInt(requiredWei);

  const currentWei = BigInt(await web3.eth.getBalance(FROM));

  if (currentWei >= neededWei) {
    log("✔️ Dostatočné ETH v peňaženke");
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

  log(`✔️ Doplatok hotový`);
}

/* ============================================================
   FUND (send ETH to NFT)
============================================================ */
async function fund(user, tokenId, amountEth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const gasPrice = await getGas();
  const rawWei = BigInt(web3.utils.toWei(amountEth.toString(), "ether"));

  // MINIMUM 0.001 ETH → KONTRAKT TO VYŽADUJE
  const MIN_VALUE_WEI = BigInt(web3.utils.toWei("0.001", "ether"));

  let valueWei = rawWei;

  if (valueWei < MIN_VALUE_WEI) {
    valueWei = MIN_VALUE_WEI;
    log(`⚠️ Applied minimum value: 0.001 ETH`);
  }

  const gasLimit = await contract.methods
    .fundTokenFor(user, tokenId)
    .estimateGas({ from: FROM, value: valueWei.toString() });

  await autoTopup(valueWei, gasLimit, gasPrice);

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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        payment_id,
        tx_hash
      })
    });

    log(`↩️ update_order: ${await r.text()}`);
  } catch (e) {
    log("❌ update_order FAIL:", e.message);
  }
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const action = req.body?.action;

    if (action === "mint") {
      const payment_id = req.body.payment_id;
      const user       = req.body.user_address;
      const token      = req.body.token_id;
      const eurAmount  = parseFloat(req.body.amount_eur);

      const rate = await getEthRate();
      let eth = eurAmount > 0 ? eurAmount / rate : 0; // min. value rule inside fund()

      log(`🔥 MINT: ${payment_id} → token=${token} EUR=${eurAmount} → ETH=${eth}`);

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