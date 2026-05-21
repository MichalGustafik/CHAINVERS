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
].filter(Boolean);

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

function cleanEthString(value) {
  let s = String(value || "0").trim().replace(",", ".");

  if (!s || s === "." || Number(s) <= 0) return "0";

  if (s.includes("e") || s.includes("E")) {
    s = Number(s).toFixed(18);
  }

  if (s.includes(".")) {
    const [a, b = ""] = s.split(".");
    s = a + "." + b.slice(0, 18);
  }

  s = s.replace(/\.?0+$/, "");

  return s || "0";
}

/* ============================================================
   RAW ABI CALLS — no Contract object
============================================================ */
async function isOriginalTokenRaw(tokenId) {
  const data = web3.eth.abi.encodeFunctionCall(
    {
      type: "function",
      name: "isOriginalToken",
      inputs: [{ type: "uint256", name: "id" }]
    },
    [String(tokenId)]
  );

  const result = await web3.eth.call({
    to: CONTRACT,
    data
  });

  return web3.eth.abi.decodeParameter("bool", result);
}

function encodeCreditCall(isOriginal, tokenId, valueWei) {
  return web3.eth.abi.encodeFunctionCall(
    {
      type: "function",
      name: isOriginal ? "backendCreditOrigin" : "backendCreditCopy",
      inputs: [
        { type: "uint256", name: "id" },
        { type: "uint256", name: "amt" }
      ]
    },
    [String(tokenId), String(valueWei)]
  );
}

async function tokenAvailableRaw(tokenId) {
  const data = web3.eth.abi.encodeFunctionCall(
    {
      type: "function",
      name: "tokenAvailableForWithdraw",
      inputs: [{ type: "uint256", name: "id" }]
    },
    [String(tokenId)]
  );

  const result = await web3.eth.call({
    to: CONTRACT,
    data
  });

  return web3.eth.abi.decodeParameter("uint256", result);
}

/* ============================================================
   STEP 1: SEND ETH TO CONTRACT
============================================================ */
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

/* ============================================================
   STEP 2: CREDIT INTERNAL NFT BALANCE
============================================================ */
async function creditInternalBalance(tokenId, valueWei) {
  const isOriginal = await isOriginalTokenRaw(tokenId);

  await log(`TOKEN TYPE DETECTED = ${isOriginal ? "ORIGIN" : "COPY"}`);

  const data = encodeCreditCall(isOriginal, tokenId, valueWei);
  const gasPrice = await getGas();

  const gasLimit = await web3.eth.estimateGas({
    from: FROM,
    to: CONTRACT,
    data,
    value: "0"
  });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: "0",
    data,
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  const available = await tokenAvailableRaw(tokenId);

  return {
    txHash: receipt.transactionHash,
    tokenType: isOriginal ? "origin" : "copy",
    availableWei: available,
    availableEth: web3.utils.fromWei(available, "ether")
  };
}

/* ============================================================
   CREDIT NFT TWO-STEP
============================================================ */
async function creditNFT(tokenId, ethString) {
  const valueWei = web3.utils.toWei(ethString, "ether");

  await log(`CREDIT NFT START → token=${tokenId}, ETH=${ethString}, WEI=${valueWei}`);

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
      const paymentId  = body.payment_id;
      const tokenId    = Number(body.token_id);
      const eur        = Number(body.amount_eur || 0);
      const amountMode = body.amount_mode || "eur";
      const amountEth  = body.amount_eth || "0";
      const user       = body.user_address || "";

      await log("===== NEW CREDIT NFT =====");
      await log(`Order=${paymentId} | Token=${tokenId} | Mode=${amountMode} | EUR=${eur} | ETH=${amountEth} | User=${user}`);

      if (!tokenId || tokenId <= 0) {
        return res.json({ ok:false, error:"Missing token_id" });
      }

      let ethString = "0";
      let rate = null;

      if (amountMode === "eth") {
        ethString = cleanEthString(amountEth);
      } else {
        if (eur <= 0) {
          return res.json({ ok:false, error:"Amount EUR must be > 0" });
        }

        rate = await getRate();
        const ethCalc = eur / rate;
        ethString = cleanEthString(ethCalc);

        await log(`Rate=${rate} EUR/ETH → ETH=${ethString}`);
      }

      if (Number(ethString) <= 0) {
        return res.json({ ok:false, error:"ETH amount must be > 0" });
      }

      const walletBal = await balanceEth();
      const neededEth = Number(ethString);

      if (walletBal < neededEth) {
        await log(`❌ Wallet=${walletBal} ETH < Needed=${neededEth}`);
        return res.json({
          ok:false,
          error:"Low wallet balance",
          wallet_eth: walletBal,
          needed_eth: neededEth
        });
      }

      const result = await creditNFT(tokenId, ethString);

      return res.json({
        ok:true,
        action:"credit_nft",
        payment_id: paymentId,
        token_id: tokenId,
        user_address: user,
        amount_mode: amountMode,
        rate_eur_eth: rate,
        tx_hash: result.tx_credit,
        tx_hash_send: result.tx_send,
        tx_hash_credit: result.tx_credit,
        token_type: result.token_type,
        sent_eth: result.sent_eth,
        sent_wei: result.sent_wei,
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