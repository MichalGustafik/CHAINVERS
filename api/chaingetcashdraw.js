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
   LOAD ORDERS - PRIAMY PRÍSTUP K SÚBOROM
============================================================ */
async function loadOrders(user) {
  console.log("[ORDERS] Loading for user:", user);
  
  // MOŽNOSŤ 1: Priamy prístup k orders.json
  const directUrl = `https://chainvers.free.nf/chainuserdata/${user}/orders.json`;
  console.log("[ORDERS] Trying direct file:", directUrl);
  
  try {
    const response = await axios.get(directUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Chainvers-Withdraw-API/1.0',
        'Accept': 'application/json'
      }
    });
    
    console.log("[ORDERS] Direct file status:", response.status);
    
    // Ak dostaneme HTML (DDoS protection)
    if (typeof response.data === 'string' && response.data.includes('<html>')) {
      console.log("[ORDERS] DDoS protection active on direct file");
      throw new Error("DDoS protection blocks access");
    }
    
    // Spracuj odpoveď
    if (Array.isArray(response.data)) {
      console.log("[ORDERS] Success: Got array with", response.data.length, "items");
      return response.data;
    }
    
    if (typeof response.data === 'string') {
      try {
        const parsed = JSON.parse(response.data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        console.log("[ORDERS] JSON parse error:", e.message);
      }
    }
    
    return [];
    
  } catch (error) {
    console.log("[ORDERS ERROR]", error.message);
    
    // MOŽNOSŤ 2: Fallback na testovacie dáta
    console.log("[ORDERS] Using fallback test data");
    
    // TOTO ZMEŇ NA REÁLNE DÁTA TÝCHTO POUŽÍVATEĽOV!
    const testData = {
      "0x6907baCC70369072d9a1ff630787Cb46667bc33C": [
        {
          "user_address": "0x6907baCC70369072d9a1ff630787Cb46667bc33C",
          "token_id": "1",
          "contract_gain": "0.25",
          "chain_status": "confirmed"
        },
        {
          "user_address": "0x6907baCC70369072d9a1ff630787Cb46667bc33C",
          "token_id": "2",
          "contract_gain": "0.15",
          "chain_status": "confirmed"
        }
      ],
      "0x1234567890123456789012345678901234567890": [
        {
          "user_address": "0x1234567890123456789012345678901234567890",
          "token_id": "3",
          "contract_gain": "0.1",
          "chain_status": "confirmed"
        }
      ]
    };
    
    // Vráť testovacie dáta pre daného používateľa
    if (testData[user]) {
      console.log("[ORDERS] Returning test data for user");
      return testData[user];
    }
    
    // Ak používateľ nie je v testovacích dátach, vráť prázdne pole
    console.log("[ORDERS] No test data for this user");
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
      return res.json({ 
        ok:false, 
        error:"exceeds_balance", 
        max:0,
        debug: `No withdrawable balance found. Orders count: ${orders.length}`
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
    return res.json({ 
      ok:false, 
      error:e.message,
      suggestion: "Check if contract has sufficient funds and user has valid orders."
    });
  }
}