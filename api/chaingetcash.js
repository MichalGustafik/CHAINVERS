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

/* ============================================================
   RPC FALLBACK
============================================================ */
const RPCs = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

async function initWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✓ Using RPC:", rpc);
      return w3;
    } catch {}
  }
  throw new Error("No working RPC");
}

const web3 = await initWeb3();

/* ============================================================
   ABI (LEN TO, ČO TVOJ KONTRAKT NAOZAJ MÁ)
============================================================ */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
    stateMutability: "payable"
  }
];

/* ============================================================
   LOGGING
============================================================ */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`
      })
    });
  } catch(e) {
    console.log("log_fail:", e.message);
  }
}

const log = async (...m) => {
  console.log(...m);
  sendLog(m.join(" "));
};

/* ============================================================
   RATE (COINGECKO)
============================================================ */
async function getRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    return j?.ethereum?.eur || 2500;
  } catch {
    return 2500;
  }
}

/* ============================================================
   GAS
============================================================ */
async function getGas() {
  try {
    return await web3.eth.getGasPrice();
  } catch {
    return web3.utils.toWei("0.2", "gwei");
  }
}

/* ============================================================
   WALLET BALANCE (FROM)
============================================================ */
async function balanceEth() {
  const w = await web3.eth.getBalance(FROM);
  return Number(web3.utils.fromWei(w, "ether"));
}

/* ============================================================
   MINT COPY
============================================================ */
async function sendMint(tokenId, ethValue) {

  const contract = new web3.eth.Contract(ABI, CONTRACT);

  //
  // KONVERZIA ETH → WEI
  //
  const valueWei =
    Number(ethValue) === 0
      ? "0"
      : web3.utils.toWei(ethValue.toString(), "ether");

  await log(`MINT request → token=${tokenId}, ETH=${ethValue}, WEI=${valueWei}`);

  const gasPrice = await getGas();

  //
  // odhad gas → dôležité
  //
  let gasLimit;
  try {
    gasLimit = await contract.methods.mintCopy(tokenId).estimateGas({
      from: FROM,
      value: valueWei
    });
  } catch(e) {
    await log("⚠️ estimateGas failed:", e.message);
    throw e;
  }

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(tokenId).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);

  try {
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
    await log(`🔥 Mint OK → TX=${receipt.transactionHash}`);
    return receipt.transactionHash;
  } catch(e) {
    await log(`❌ Mint FAIL → ${e.message}`);
    throw e;
  }
}

/* ============================================================
   SYNC S INFINITYFREE (UPDATE ORDER)
============================================================ */
async function updateIF(orderId, tx) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({ order_id: orderId, tx_hash: tx })
    });
    await log("↩️ updateIF RESP:", await r.text());
  } catch(e) {
    await log("updateIF ERROR:", e.message);
  }
}

/* ============================================================
   API HANDLER
============================================================ */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(400).json({ ok:false, error:"POST required" });
    }

    const body = req.body || {};
    const action = body.action;

    /* -----------------------------------
       KONTRAKT BALANCE (FROM PEŇAŽENKA)
    ----------------------------------- */
    if (action === "balance") {
      const b = await balanceEth();
      await log(`💠 Contract wallet balance: ${b} ETH`);
      return res.json({ ok:true, balance_eth:b });
    }

    /* -----------------------------------
       MINT COPY
    ----------------------------------- */
    if (action === "mint") {

      const paymentId = body.payment_id;
      const tokenId   = Number(body.token_id);
      const eur       = Number(body.amount_eur || 0);

      await log(`===== NEW MINT =====`);
      await log(`Order=${paymentId} | Token=${tokenId} | EUR=${eur}`);

      const rate = await getRate();
      let eth = eur > 0 ? eur / rate : 0;

      await log(`Rate EUR/ETH=${rate}, calculated ETH=${eth}`);

      // ZERO mode – skutočná nula
      if (eur === 0) {
        eth = 0;
        await log("FREE MINT MODE → sending 0 ETH");
      }

      // Check wallet balance
      const walletBal = await balanceEth();
      const needed = eth;

      if (walletBal < needed) {
        await log(`❌ NOT ENOUGH FUNDS. Wallet ${walletBal} ETH < need ${needed}`);
        return res.json({ ok:false, error:"Insufficient wallet balance" });
      }

      const txHash = await sendMint(tokenId, eth);

      await updateIF(paymentId, txHash);

      return res.json({
        ok: true,
        payment_id: paymentId,
        tx_hash: txHash,
        sent_eth: eth
      });
    }

    /* -----------------------------------
       default fallback
    ----------------------------------- */
    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch(e) {
    await log("❌ HANDLER ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}