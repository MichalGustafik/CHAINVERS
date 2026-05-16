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
   ABI
============================================================ */
const ABI = [
  {
    type: "function",
    name: "isOriginalToken",
    inputs: [{ type: "uint256", name: "id" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "backendCreditOrigin",
    inputs: [
      { type: "uint256", name: "id" },
      { type: "uint256", name: "amt" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "backendCreditCopy",
    inputs: [
      { type: "uint256", name: "id" },
      { type: "uint256", name: "amt" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "tokenAvailableForWithdraw",
    inputs: [{ type: "uint256", name: "id" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view"
  }
];

/* ============================================================
   LOGGING
============================================================ */
async function sendLog(msg) {
  if (!INF_FREE_URL) return;

  const target = `${INF_FREE_URL}/accptpay.php?action=save_log`;

  try {
    const r1 = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "Referer": INF_FREE_URL
      },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`
      })
    });

    const t1 = await r1.text();

    if (!t1.includes("__test=")) return;

    const match = t1.match(/__test=([a-fA-F0-9]+)/);
    const cookieValue = match ? match[1] : null;

    if (cookieValue) {
      await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          "Cookie": `__test=${cookieValue}`,
          "Referer": INF_FREE_URL
        },
        body: new URLSearchParams({
          message: `[${new Date().toISOString()}] ${msg}`
        })
      });
    }
  } catch (e) {
    console.log("log_fail:", e.message);
  }
}

const log = async (...m) => {
  console.log(...m);
  await sendLog(m.join(" "));
};

/* ============================================================
   UTIL
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

async function sendEthToContract(valueWei) {
  const gasPrice = await getGas();

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    gas: 50000,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  return receipt.transactionHash;
}

async function creditInternalBalance(tokenId, valueWei) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const isOriginal = await contract.methods.isOriginalToken(tokenId).call();

  const method = isOriginal
    ? contract.methods.backendCreditOrigin(tokenId, valueWei)
    : contract.methods.backendCreditCopy(tokenId, valueWei);

  const gasPrice = await getGas();

  const gasLimit = await method.estimateGas({
    from: FROM
  });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: "0",
    data: method.encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  const available = await contract.methods.tokenAvailableForWithdraw(tokenId).call();

  return {
    txHash: receipt.transactionHash,
    tokenType: isOriginal ? "origin" : "copy",
    availableWei: available,
    availableEth: web3.utils.fromWei(available, "ether")
  };
}

async function creditNFT(tokenId, ethValue) {
  const valueWei = web3.utils.toWei(ethValue.toString(), "ether");

  await log(`CREDIT NFT START → token=${tokenId}, ETH=${ethValue}, WEI=${valueWei}`);

  const balBefore = await web3.eth.getBalance(CONTRACT);
  await log(`CONTRACT BEFORE = ${web3.utils.fromWei(balBefore, "ether")} ETH`);

  await log("STEP 1 → SEND ETH TO CONTRACT");
  const txSend = await sendEthToContract(valueWei);
  await log(`SEND ETH OK → TX=${txSend}`);

  const balMiddle = await web3.eth.getBalance(CONTRACT);
  await log(`CONTRACT AFTER SEND = ${web3.utils.fromWei(balMiddle, "ether")} ETH`);

  await log("STEP 2 → CREDIT NFT INTERNAL BALANCE");
  const credit = await creditInternalBalance(tokenId, valueWei);
  await log(`CREDIT OK → TX=${credit.txHash}`);
  await log(`NFT TYPE = ${credit.tokenType}`);
  await log(`NFT AVAILABLE = ${credit.availableEth} ETH`);

  const balAfter = await web3.eth.getBalance(CONTRACT);
  await log(`CONTRACT AFTER CREDIT = ${web3.utils.fromWei(balAfter, "ether")} ETH`);

  return {
    tx_send: txSend,
    tx_credit: credit.txHash,
    token_type: credit.tokenType,
    sent_wei: valueWei,
    sent_eth: web3.utils.fromWei(valueWei, "ether"),
    contract_before: web3.utils.fromWei(balBefore, "ether"),
    contract_after_send: web3.utils.fromWei(balMiddle, "ether"),
    contract_after_credit: web3.utils.fromWei(balAfter, "ether"),
    available_eth: credit.availableEth
  };
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

    if (action === "balance") {
      const b = await balanceEth();
      await log(`💠 FROM balance: ${b} ETH`);
      return res.json({ ok:true, balance_eth:b });
    }

    if (action === "credit_nft") {
      const paymentId = body.payment_id;
      const tokenId   = Number(body.token_id);
      const eur       = Number(body.amount_eur || 0);
      const user      = body.user_address || "";

      await log("===== NEW CREDIT NFT =====");
      await log(`Order=${paymentId} | Token=${tokenId} | EUR=${eur} | User=${user}`);

      if (!tokenId || tokenId <= 0) {
        return res.json({ ok:false, error:"Missing token_id" });
      }

      if (eur <= 0) {
        return res.json({ ok:false, error:"Amount must be > 0" });
      }

      const rate = await getRate();
      const eth = eur / rate;

      await log(`Rate=${rate} EUR/ETH → ETH=${eth}`);

      const walletBal = await balanceEth();

      if (walletBal < eth) {
        await log(`❌ Wallet=${walletBal} ETH < Needed=${eth}`);
        return res.json({
          ok:false,
          error:"Low wallet balance",
          wallet_eth: walletBal,
          needed_eth: eth
        });
      }

      const result = await creditNFT(tokenId, eth);

      return res.json({
        ok:true,
        action:"credit_nft",
        payment_id: paymentId,
        token_id: tokenId,
        user_address: user,
        tx_hash: result.tx_credit,
        tx_hash_send: result.tx_send,
        tx_hash_credit: result.tx_credit,
        token_type: result.token_type,
        sent_eth: result.sent_eth,
        contract_before: result.contract_before,
        contract_after_send: result.contract_after_send,
        contract_after_credit: result.contract_after_credit,
        contract_gain: result.sent_eth,
        available_eth: result.available_eth
      });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch(e) {
    await log(`❌ HANDLER ERROR: ${e.message}`);
    return res.status(500).json({ ok:false, error:e.message });
  }
}