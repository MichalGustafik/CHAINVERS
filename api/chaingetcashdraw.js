console.log("=== BOOT: CHAINVERS chaingetcashdraw.js ===");

import Web3 from "web3";
import axios from "axios";

/* ============================================================
   SAFE BODY PARSER (Vercel)
============================================================ */
async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch { resolve({}); }
    });
  });
}

/* ============================================================
   RPC FALLBACK
============================================================ */
const PRIMARY = process.env.PROVIDER_URL;
const FALLBACKS = [
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://base.blockpi.network/v1/rpc/public",
  "https://rpc.ankr.com/base"
];

async function initWeb3() {
  const list = [PRIMARY, ...FALLBACKS].filter(Boolean);
  for (const rpc of list) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("[RPC OK]", rpc);
      return w3;
    } catch {
      console.log("[RPC FAIL]", rpc);
    }
  }
  throw new Error("No working RPC");
}

/* ============================================================
   ABI – backendWithdraw ONLY
============================================================ */
const ABI = [
  {
    "inputs":[
      {"internalType":"address","name":"to","type":"address"},
      {"internalType":"uint256","name":"amount","type":"uint256"}
    ],
    "name":"backendWithdraw",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

/* ============================================================
   LOAD ORDERS
============================================================ */
async function loadOrders(user) {
  const base = process.env.INF_FREE_URL || "https://chainvers.free.nf";
  const url  = `${base.replace(/\/+$/,"")}/get_orders_raw.php?user=${encodeURIComponent(user)}`;

  console.log("[ORDERS] loading:", url);
  const r = await axios.get(url, { timeout: 8000 });
  return Array.isArray(r.data) ? r.data : [];
}

/* ============================================================
   CALC MAX ETH FROM ORDERS  ✅ FIXED
============================================================ */
function calcMaxFromOrders(raw, user) {
  let max = 0;

  for (const o of raw) {
    if (!o) continue;

    // user check
    if (
      !o.user_address ||
      o.user_address.toLowerCase() !== user.toLowerCase()
    ) continue;

    // chain_status – berieme všetko okrem undefined/null
    if (o.chain_status === undefined || o.chain_status === null) continue;

    // contract_gain safe
    let g = o.contract_gain;
    if (g === undefined || g === null) continue;

    if (typeof g === "string") {
      g = g.replace(",", ".").trim();
    }

    const gain = Number(g);

    if (!isNaN(gain) && gain > 0) {
      max += gain;
    }
  }

  // floating fix
  return Math.floor(max * 1e18) / 1e18;
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  console.log("=== API CALL: withdraw ===");

  try {
    const body = await parseBody(req);
    const user = body.user;
    const reqAmount = Number(body.amount || 0);

    console.log("[REQ] user =", user, "amount =", reqAmount);

    if (!user || !reqAmount || reqAmount <= 0) {
      return res.json({ ok:false, error:"bad_request" });
    }

    /* --------------------------------------------------------
       LOAD ORDERS
    -------------------------------------------------------- */
    const orders = await loadOrders(user);
    console.log("[ORDERS COUNT]", orders.length);

    const maxEth = calcMaxFromOrders(orders, user);
    console.log("[MAX FROM ORDERS]", maxEth);

    if (maxEth <= 0) {
      return res.json({ ok:false, error:"exceeds_balance", max:0 });
    }

    if (reqAmount > maxEth) {
      return res.json({ ok:false, error:"exceeds_balance", max:maxEth });
    }

    /* --------------------------------------------------------
       INIT WEB3
    -------------------------------------------------------- */
    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    console.log("[OWNER]", owner.address);

    /* --------------------------------------------------------
       GAS LOGIC
    -------------------------------------------------------- */
    const weiRequested = BigInt(Math.floor(reqAmount * 1e18));

    const method = contract.methods.backendWithdraw(
      user,
      weiRequested.toString()
    );

    const gas = await method.estimateGas({ from: owner.address });
    const gasPrice = BigInt(await web3.eth.getGasPrice());
    const gasCost = BigInt(gas) * gasPrice;

    console.log("[GAS WEI]", gasCost.toString());

    if (weiRequested <= gasCost) {
      return res.json({ ok:false, error:"amount_too_small_for_gas" });
    }

    const finalWei = weiRequested - gasCost;
    console.log("[FINAL SEND WEI]", finalWei.toString());

    /* --------------------------------------------------------
       SEND TX
    -------------------------------------------------------- */
    const txData = {
      from: owner.address,
      to: contractAddr,
      gas,
      data: contract.methods.backendWithdraw(
        user,
        finalWei.toString()
      ).encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(
      txData,
      process.env.PRIVATE_KEY
    );

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    console.log("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      sent_eth: Number(finalWei) / 1e18,
      gas_eth: Number(gasCost) / 1e18,
      max_before: maxEth
    });

  } catch (e) {
    console.log("[FATAL]", e.message);
    return res.json({ ok:false, error:e.message });
  }
}