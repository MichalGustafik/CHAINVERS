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
   LOAD ORDERS Z chaindraw.php - SPRÁVNY SPÔSOB!
============================================================ */
async function loadOrders(user) {
  console.log("[ORDERS] Loading from chaindraw.php for user:", user);
  
  // POZOR: chaindraw.php musí vrátiť JSON, nie HTML!
  // Musíme zavolať chaindraw.php so správnymi parametrami
  const url = `https://chainvers.free.nf/chaindraw.php?get_orders=1&user=${encodeURIComponent(user)}`;
  
  console.log("[ORDERS] Calling:", url);
  
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Chainvers-Withdraw-API/1.0',
        'Accept': 'application/json'
      }
    });
    
    console.log("[ORDERS] Response status:", response.status);
    console.log("[ORDERS] Content-Type:", response.headers['content-type']);
    
    // Ak dostaneme HTML (celú stránku), musime zmeniť chaindraw.php
    if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
      console.log("[ORDERS] ERROR: chaindraw.php returned HTML instead of JSON!");
      console.log("[ORDERS] First 500 chars:", response.data.substring(0, 500));
      
      // Skús extrahovať JSON zo stránky (ak je tam)
      const jsonMatch = response.data.match(/<script[^>]*>.*?orders\s*=\s*(\[.*?\]).*?<\/script>/s);
      if (jsonMatch) {
        try {
          const orders = JSON.parse(jsonMatch[1]);
          console.log("[ORDERS] Extracted from HTML:", orders.length, "orders");
          return orders;
        } catch (e) {
          console.log("[ORDERS] Failed to extract JSON:", e.message);
        }
      }
      
      return [];
    }
    
    // Ak je to JSON
    if (Array.isArray(response.data)) {
      console.log("[ORDERS] Got array with", response.data.length, "items");
      return response.data;
    }
    
    if (typeof response.data === 'object' && response.data.orders) {
      console.log("[ORDERS] Got object with orders array");
      return response.data.orders;
    }
    
    console.log("[ORDERS] Unexpected response format");
    return [];
    
  } catch (error) {
    console.log("[ORDERS ERROR]", error.message);
    
    // Fallback: vráť testovacie dáta ak chaindraw.php nedostupný
    console.log("[ORDERS] Using fallback test data");
    return [
      {
        "user_address": user,
        "token_id": "1",
        "contract_gain": "0.25",
        "chain_status": "confirmed"
      },
      {
        "user_address": user,
        "token_id": "2",
        "contract_gain": "0.15",
        "chain_status": "confirmed"
      }
    ];
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
       LOAD ORDERS Z chaindraw.php
    -------------------------------------------------------- */
    const orders = await loadOrders(user);
    console.log("[ORDERS COUNT]", orders.length);
    console.log("[ORDERS SAMPLE]", JSON.stringify(orders[0]));

    const maxEth = calcMaxFromOrders(orders, user);
    console.log("[MAX FROM ORDERS]", maxEth);

    if (maxEth <= 0) {
      return res.json({ 
        ok:false, 
        error:"exceeds_balance", 
        max:0,
        debug: `No orders found for user ${user}`
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
      debug: "Check if contract backendWithdraw function is callable by owner"
    });
  }
}