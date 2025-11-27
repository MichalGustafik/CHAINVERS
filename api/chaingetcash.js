import Web3 from "web3";
import fetch from "node-fetch";

/* ============================================================
   ENV
============================================================ */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL; // len na logy

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
   ABI (mintCopy)
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
  if (!INF_FREE_URL) return;
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
   UTIL: Rate, Gas, Balance
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

async function getGas() {
  try {
    return await web3.eth.getGasPrice();
  } catch {
    return web3.utils.toWei("0.2", "gwei");
  }
}

async function balanceEth() {
  const w = await web3.eth.getBalance(FROM);
  return Number(web3.utils.fromWei(w, "ether"));
}

/* ============================================================
   SEND MINT
============================================================ */
async function sendMint(tokenId, ethValue) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const valueWei =
    Number(ethValue) === 0
      ? "0"
      : web3.utils.toWei(ethValue.toString(), "ether");

  await log(`MINT → token=${tokenId}, ETH=${ethValue}, WEI=${valueWei}`);

  const gasPrice = await getGas();

  let gasLimit;
  try {
    gasLimit = await contract.methods.mintCopy(tokenId).estimateGas({
      from: FROM,
      value: valueWei
    });
  } catch(e) {
    await log("⚠️ estimateGas fail:", e.message);
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

  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`🔥 Mint OK → TX=${receipt.transactionHash}`);
  return receipt.transactionHash;
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

    /* === WALLET BALANCE === */
    if (action === "balance") {
      const b = await balanceEth();
      await log(`💠 Balance: ${b} ETH`);
      return res.json({ ok:true, balance_eth:b });
    }

    /* === MINT === */
    if (action === "mint") {
      const paymentId = body.payment_id;
      const tokenId   = Number(body.token_id);
      const eur       = Number(body.amount_eur || 0);

      await log("===== NEW MINT =====");
      await log(`Order=${paymentId} | Token=${tokenId} | EUR=${eur}`);

      const rate = await getRate();
      let eth = eur > 0 ? eur / rate : 0;

      await log(`Rate=${rate} → ETH=${eth}`);

      if (eur === 0) {
        eth = 0;
        await log("FREE MINT MODE → 0 ETH");
      }

      const bal = await balanceEth();
      if (bal < eth) {
        await log(`❌ Wallet ${bal} ETH < ${eth}`);
        return res.json({ ok:false, error:"Low wallet balance" });
      }

      const txHash = await sendMint(tokenId, eth);

      return res.json({
        ok: true,
        payment_id: paymentId,
        tx_hash: txHash,
        sent_eth: eth
      });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch(e) {
    await log("❌ ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}