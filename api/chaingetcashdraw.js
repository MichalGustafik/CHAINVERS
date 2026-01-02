// /api/chaingetcashdraw.js - UPRAVENÁ VERZIA
console.log("=== BOOT: CHAINVERS chaingetcashdraw.js ===");

import Web3 from "web3";
import { promises as fs } from 'fs';
import path from 'path';

const DATA_FILE = '/tmp/orders_data.json';

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

async function initWeb3() {
  const PRIMARY = process.env.PROVIDER_URL;
  const FALLBACKS = [
    "https://base.llamarpc.com",
    "https://base.publicnode.com",
    "https://base.blockpi.network/v1/rpc/public",
    "https://rpc.ankr.com/base"
  ];
  
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
   NAČÍTAJ DÁTA Z ULOŽENÉHO SÚBORU
============================================================ */
async function loadOrders(user) {
  console.log("[ORDERS] Loading from stored data for:", user);
  
  try {
    // Načítaj dáta zo súboru
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const allData = JSON.parse(data);
    
    const userData = allData[user];
    
    if (userData && Array.isArray(userData.orders)) {
      console.log(`[ORDERS] Found ${userData.orders.length} orders for ${user}`);
      return userData.orders;
    } else {
      console.log(`[ORDERS] No data found for ${user}`);
      return [];
    }
    
  } catch (error) {
    console.log("[ORDERS ERROR]", error.message);
    
    // Fallback: skús dostať dáta priamo z requestu
    return [];
  }
}

/* ============================================================
   CALC MAX ETH FROM ORDERS
============================================================ */
function calcMaxFromOrders(raw, user) {
  let max = 0;

  for (const o of raw) {
    if (!o) continue;

    if (!o.user_address || o.user_address.toLowerCase() !== user.toLowerCase()) continue;
    if (o.chain_status === undefined || o.chain_status === null) continue;

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

  return Math.floor(max * 1e18) / 1e18;
}

/* ============================================================
   MAIN HANDLER - PODPORA PRE DÁTA Z REQUESTU
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
    const tokenId = body.token_id;
    
    console.log("[REQ] user =", user, "amount =", reqAmount, "token_id =", tokenId);

    if (!user || !reqAmount || reqAmount <= 0) {
      return res.json({ ok:false, error:"bad_request" });
    }

    /* --------------------------------------------------------
       NAČÍTAJ DÁTA - BUĎ Z REQUESTU ALEBO Z ULOŽENÝCH
    -------------------------------------------------------- */
    let orders = [];
    
    // Ak prišli dáta priamo v requeste (nový spôsob)
    if (body.all_orders && Array.isArray(body.all_orders)) {
      console.log("[ORDERS] Using data from request body:", body.all_orders.length, "items");
      orders = body.all_orders;
    } else {
      // Starý spôsob - načítaj z uloženého súboru
      orders = await loadOrders(user);
      console.log("[ORDERS] Loaded from storage:", orders.length, "items");
    }

    const maxEth = calcMaxFromOrders(orders, user);
    console.log("[MAX FROM ORDERS]", maxEth);

    if (maxEth <= 0) {
      return res.json({ 
        ok:false, 
        error:"exceeds_balance", 
        max:0,
        debug: `No withdrawable balance. Orders: ${orders.length}`
      });
    }

    if (reqAmount > maxEth) {
      return res.json({ 
        ok:false, 
        error:"exceeds_balance", 
        max:maxEth,
        requested: reqAmount
      });
    }

    /* --------------------------------------------------------
       ZBYTOK KÓDU (WEB3, TRANSACTION) OSTÁVA ROVNAKÝ
    -------------------------------------------------------- */
    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    console.log("[OWNER]", owner.address);

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
    console.log("[FATAL] Stack:", e.stack);
    
    // Špeciálna správa pre execution reverted
    if (e.message.includes("execution reverted")) {
      return res.json({ 
        ok: false, 
        error: "contract_execution_reverted",
        details: "Kontrakt odmietol transakciu. Možné príčiny: nedostatok prostriedkov, kontrakt pozastavený, alebo chybná adresa.",
        suggestion: "Skontroluj stav kontraktu a či má dostatok ETH."
      });
    }
    
    return res.json({ 
      ok:false, 
      error: e.message,
      type: e.name
    });
  }
}