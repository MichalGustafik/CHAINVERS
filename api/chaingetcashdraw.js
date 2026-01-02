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
   LOAD ORDERS WITH DEBUG
============================================================ */
async function loadOrders(user) {
  const base = process.env.INF_FREE_URL || "https://chainvers.free.nf";
  const url  = `${base.replace(/\/+$/,"")}/get_orders_raw.php?user=${encodeURIComponent(user)}`;

  console.log("[ORDERS DEBUG] === START LOAD ORDERS ===");
  console.log("[ORDERS DEBUG] URL:", url);
  console.log("[ORDERS DEBUG] User:", user);

  try {
    const r = await axios.get(url, { 
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Chainvers-Withdraw/1.0'
      }
    });
    
    console.log("[ORDERS DEBUG] Response status:", r.status);
    console.log("[ORDERS DEBUG] Response headers:", JSON.stringify(r.headers));
    console.log("[ORDERS DEBUG] Raw data type:", typeof r.data);
    console.log("[ORDERS DEBUG] Raw data (first 1000 chars):", 
      typeof r.data === 'string' ? r.data.substring(0, 1000) : JSON.stringify(r.data).substring(0, 1000));
    
    // Debug: Show full response for empty array
    if (Array.isArray(r.data) && r.data.length === 0) {
      console.log("[ORDERS DEBUG] WARNING: Empty array returned!");
      console.log("[ORDERS DEBUG] Full response:", JSON.stringify(r));
      
      // Try alternative endpoint structure
      try {
        const altUrl = `https://chainvers.free.nf/chainuserdata/${encodeURIComponent(user)}/orders.json`;
        console.log("[ORDERS DEBUG] Trying alternative:", altUrl);
        const altRes = await axios.get(altUrl, { timeout: 5000 });
        console.log("[ORDERS DEBUG] Alternative response:", 
          JSON.stringify(altRes.data).substring(0, 500));
        return Array.isArray(altRes.data) ? altRes.data : [];
      } catch (altError) {
        console.log("[ORDERS DEBUG] Alternative failed:", altError.message);
      }
    }
    
    if (!r.data) {
      console.log("[ORDERS DEBUG] ERROR: No data in response");
      return [];
    }
    
    // Handle different response formats
    if (Array.isArray(r.data)) {
      console.log("[ORDERS DEBUG] Success: Array with", r.data.length, "items");
      return r.data;
    }
    
    if (typeof r.data === 'string') {
      console.log("[ORDERS DEBUG] Data is string, attempting to parse");
      try {
        const parsed = JSON.parse(r.data);
        console.log("[ORDERS DEBUG] Parsed result type:", typeof parsed);
        console.log("[ORDERS DEBUG] Parsed result:", JSON.stringify(parsed).substring(0, 500));
        
        if (Array.isArray(parsed)) {
          return parsed;
        } else if (parsed && typeof parsed === 'object') {
          // If it's an object, try to extract array
          const keys = Object.keys(parsed);
          console.log("[ORDERS DEBUG] Object keys:", keys);
          
          // Check for common array keys
          for (const key of ['orders', 'data', 'result', 'items']) {
            if (Array.isArray(parsed[key])) {
              console.log("[ORDERS DEBUG] Found array in key:", key);
              return parsed[key];
            }
          }
          
          // If object has numeric keys, convert to array
          if (keys.every(k => !isNaN(k))) {
            console.log("[ORDERS DEBUG] Converting numeric-key object to array");
            return Object.values(parsed);
          }
        }
      } catch (parseError) {
        console.log("[ORDERS DEBUG] Parse error:", parseError.message);
      }
    }
    
    console.log("[ORDERS DEBUG] WARNING: Could not extract array from response");
    return [];
    
  } catch (error) {
    console.log("[ORDERS DEBUG] === LOAD ERROR ===");
    console.log("[ORDERS DEBUG] Error name:", error.name);
    console.log("[ORDERS DEBUG] Error message:", error.message);
    
    if (error.response) {
      console.log("[ORDERS DEBUG] Response status:", error.response.status);
      console.log("[ORDERS DEBUG] Response data:", error.response.data);
      console.log("[ORDERS DEBUG] Response headers:", error.response.headers);
    }
    
    if (error.request) {
      console.log("[ORDERS DEBUG] No response received");
      console.log("[ORDERS DEBUG] Request:", error.request);
    }
    
    console.log("[ORDERS DEBUG] === END LOAD ERROR ===");
    return [];
  } finally {
    console.log("[ORDERS DEBUG] === END LOAD ORDERS ===");
  }
}

/* ============================================================
   CALC MAX ETH FROM ORDERS WITH DETAILED DEBUG
============================================================ */
function calcMaxFromOrders(raw, user) {
  console.log("[CALC DEBUG] === START CALC MAX ===");
  console.log("[CALC DEBUG] Raw orders length:", raw.length);
  console.log("[CALC DEBUG] Target user:", user);
  console.log("[CALC DEBUG] User length:", user.length);
  console.log("[CALC DEBUG] Is valid ETH address?", /^0x[a-fA-F0-9]{40}$/.test(user));
  
  if (raw.length === 0) {
    console.log("[CALC DEBUG] WARNING: Empty raw array, returning 0");
    return 0;
  }
  
  let max = 0;
  let processed = 0;
  let matched = 0;
  
  console.log("[CALC DEBUG] First order sample:", JSON.stringify(raw[0]));
  
  for (const o of raw) {
    processed++;
    
    if (processed <= 3) { // Log only first 3 for brevity
      console.log(`[CALC DEBUG ${processed}] Order:`, JSON.stringify(o));
    }
    
    if (!o) {
      console.log(`[CALC DEBUG ${processed}] Skipped: null object`);
      continue;
    }
    
    // User check with detailed debug
    const orderUser = o.user_address || o.userAddress || o.address || o.wallet;
    if (!orderUser) {
      console.log(`[CALC DEBUG ${processed}] Skipped: no user field`);
      console.log(`[CALC DEBUG ${processed}] Available keys:`, Object.keys(o));
      continue;
    }
    
    const userLower = user.toLowerCase();
    const orderUserLower = String(orderUser).toLowerCase();
    const userMatch = orderUserLower === userLower;
    
    if (processed <= 3) {
      console.log(`[CALC DEBUG ${processed}] User compare:`, {
        requested: userLower,
        order: orderUserLower,
        match: userMatch
      });
    }
    
    if (!userMatch) {
      if (processed <= 3) {
        console.log(`[CALC DEBUG ${processed}] Skipped: user mismatch`);
      }
      continue;
    }
    
    matched++;
    
    // Chain status check
    const chainStatus = o.chain_status || o.chainStatus || o.status;
    if (processed <= 3) {
      console.log(`[CALC DEBUG ${processed}] Chain status:`, chainStatus);
    }
    
    if (chainStatus === undefined || chainStatus === null || chainStatus === '') {
      if (processed <= 3) {
        console.log(`[CALC DEBUG ${processed}] Skipped: invalid chain status`);
      }
      continue;
    }
    
    // Contract gain extraction
    let gainValue = o.contract_gain || o.contractGain || o.gain || o.amount || o.balance || o.value;
    if (processed <= 3) {
      console.log(`[CALC DEBUG ${processed}] Raw gain value:`, gainValue, typeof gainValue);
    }
    
    if (gainValue === undefined || gainValue === null) {
      if (processed <= 3) {
        console.log(`[CALC DEBUG ${processed}] Skipped: no gain value`);
      }
      continue;
    }
    
    // Convert to number
    if (typeof gainValue === "string") {
      gainValue = gainValue.replace(/,/g, ".").trim();
      // Remove any non-numeric except decimal point and minus
      gainValue = gainValue.replace(/[^\d.-]/g, '');
    }
    
    const gainNum = Number(gainValue);
    
    if (processed <= 3) {
      console.log(`[CALC DEBUG ${processed}] Numeric gain:`, gainNum, 
        "isNaN:", isNaN(gainNum), 
        "isFinite:", isFinite(gainNum),
        "> 0:", gainNum > 0);
    }
    
    if (!isNaN(gainNum) && isFinite(gainNum) && gainNum > 0) {
      const before = max;
      max += gainNum;
      if (processed <= 3) {
        console.log(`[CALC DEBUG ${processed}] Added ${gainNum}. Max: ${before} -> ${max}`);
      }
    } else {
      if (processed <= 3) {
        console.log(`[CALC DEBUG ${processed}] Skipped: invalid numeric gain`);
      }
    }
  }
  
  const fixedMax = Math.floor(max * 1e18) / 1e18;
  
  console.log("[CALC DEBUG] === SUMMARY ===");
  console.log("[CALC DEBUG] Processed orders:", processed);
  console.log("[CALC DEBUG] Matched user orders:", matched);
  console.log("[CALC DEBUG] Raw sum:", max);
  console.log("[CALC DEBUG] Fixed sum (18 decimals):", fixedMax);
  console.log("[CALC DEBUG] === END CALC MAX ===");
  
  return fixedMax;
}

/* ============================================================
   MAIN HANDLER WITH ENHANCED DEBUG
============================================================ */
export default async function handler(req, res) {
  // Store all debug logs
  const debugLogs = [];
  const originalLog = console.log;
  console.log = function(...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    debugLogs.push(msg);
    originalLog.apply(console, args);
  };
  
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    console.log("========================================");
    console.log("=== API CALL: withdraw ", new Date().toISOString(), "===");
    console.log("========================================");
    console.log("[REQ] Method:", req.method);
    console.log("[REQ] Headers:", JSON.stringify(req.headers));
    console.log("[REQ] URL:", req.url);

    const body = await parseBody(req);
    console.log("[REQ] Raw body:", JSON.stringify(body));
    
    const user = body.user;
    const reqAmount = Number(body.amount || 0);
    
    console.log("[REQ] User:", user);
    console.log("[REQ] Amount:", reqAmount);
    console.log("[REQ] Amount type:", typeof reqAmount);
    console.log("[REQ] User valid check:", user && /^0x[a-fA-F0-9]{40}$/.test(user));
    console.log("[REQ] Amount valid check:", reqAmount > 0);

    if (!user || !reqAmount || reqAmount <= 0) {
      console.log("[VALIDATION] Failed: missing user or invalid amount");
      return res.json({ 
        ok: false, 
        error: "bad_request",
        debug: {
          user_provided: !!user,
          amount_provided: reqAmount,
          validation_failed: true
        }
      });
    }

    /* --------------------------------------------------------
       LOAD ORDERS
    -------------------------------------------------------- */
    console.log("\n--- LOADING ORDERS ---");
    const orders = await loadOrders(user);
    console.log("[MAIN] Final orders array length:", orders.length);
    
    // If no orders, try direct file access as last resort
    if (orders.length === 0 && user) {
      console.log("[MAIN] No orders found, trying emergency fallback...");
      try {
        // Try to see if user directory exists
        const testUrl = `https://chainvers.free.nf/chainuserdata/${encodeURIComponent(user)}/`;
        console.log("[MAIN] Testing directory:", testUrl);
        // This is just for debug - actual implementation would need server-side check
      } catch (fallbackError) {
        console.log("[MAIN] Emergency fallback failed:", fallbackError.message);
      }
    }

    /* --------------------------------------------------------
       CALCULATE MAX
    -------------------------------------------------------- */
    console.log("\n--- CALCULATING MAX ETH ---");
    const maxEth = calcMaxFromOrders(orders, user);
    console.log("[MAIN] Calculated maxEth:", maxEth);
    console.log("[MAIN] Requested amount:", reqAmount);
    console.log("[MAIN] Amount <= max?", reqAmount <= maxEth);

    if (maxEth <= 0) {
      console.log("[MAIN] ERROR: maxEth <= 0");
      return res.json({ 
        ok: false, 
        error: "exceeds_balance", 
        max: 0,
        debug: {
          orders_count: orders.length,
          max_calculated: maxEth,
          user: user
        }
      });
    }

    if (reqAmount > maxEth) {
      console.log("[MAIN] ERROR: reqAmount > maxEth");
      return res.json({ 
        ok: false, 
        error: "exceeds_balance", 
        max: maxEth,
        debug: {
          requested: reqAmount,
          available: maxEth,
          difference: reqAmount - maxEth
        }
      });
    }

    /* --------------------------------------------------------
       INIT WEB3
    -------------------------------------------------------- */
    console.log("\n--- INITIALIZING WEB3 ---");
    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    console.log("[MAIN] Contract address:", contractAddr);
    console.log("[MAIN] Contract address valid?", /^0x[a-fA-F0-9]{40}$/.test(contractAddr));
    
    const contract = new web3.eth.Contract(ABI, contractAddr);
    console.log("[MAIN] Contract initialized");

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);
    console.log("[MAIN] Owner address:", owner.address);
    console.log("[MAIN] Owner address valid?", /^0x[a-fA-F0-9]{40}$/.test(owner.address));

    /* --------------------------------------------------------
       GAS LOGIC
    -------------------------------------------------------- */
    console.log("\n--- GAS CALCULATION ---");
    const weiRequested = BigInt(Math.floor(reqAmount * 1e18));
    console.log("[MAIN] weiRequested:", weiRequested.toString());

    const method = contract.methods.backendWithdraw(
      user,
      weiRequested.toString()
    );

    console.log("[MAIN] Estimating gas...");
    const gas = await method.estimateGas({ from: owner.address });
    console.log("[MAIN] Estimated gas:", gas.toString());

    console.log("[MAIN] Getting gas price...");
    const gasPrice = BigInt(await web3.eth.getGasPrice());
    console.log("[MAIN] Gas price:", gasPrice.toString());

    const gasCost = BigInt(gas) * gasPrice;
    console.log("[MAIN] Gas cost (wei):", gasCost.toString());
    console.log("[MAIN] Gas cost (ETH):", Number(gasCost) / 1e18);

    console.log("[MAIN] Comparing: weiRequested", weiRequested.toString(), "> gasCost", gasCost.toString(), "?");
    if (weiRequested <= gasCost) {
      console.log("[MAIN] ERROR: weiRequested <= gasCost");
      return res.json({ 
        ok: false, 
        error: "amount_too_small_for_gas",
        debug: {
          requested_wei: weiRequested.toString(),
          gas_cost_wei: gasCost.toString(),
          difference: (Number(weiRequested) - Number(gasCost)).toString()
        }
      });
    }

    const finalWei = weiRequested - gasCost;
    console.log("[MAIN] Final wei to send:", finalWei.toString());
    console.log("[MAIN] Final ETH to send:", Number(finalWei) / 1e18);

    /* --------------------------------------------------------
       SEND TX
    -------------------------------------------------------- */
    console.log("\n--- SENDING TRANSACTION ---");
    const txData = {
      from: owner.address,
      to: contractAddr,
      gas,
      data: contract.methods.backendWithdraw(
        user,
        finalWei.toString()
      ).encodeABI()
    };

    console.log("[MAIN] TX data:", JSON.stringify({
      from: txData.from,
      to: txData.to,
      gas: txData.gas,
      data_length: txData.data.length
    }));

    console.log("[MAIN] Signing transaction...");
    const signed = await web3.eth.accounts.signTransaction(
      txData,
      process.env.PRIVATE_KEY
    );
    console.log("[MAIN] Transaction signed");

    console.log("[MAIN] Sending signed transaction...");
    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    console.log("[MAIN] Transaction successful!");
    console.log("[MAIN] TX Hash:", sent.transactionHash);
    console.log("[MAIN] Block number:", sent.blockNumber);
    console.log("[MAIN] Gas used:", sent.gasUsed);

    /* --------------------------------------------------------
       SUCCESS RESPONSE
    -------------------------------------------------------- */
    console.log("\n--- SENDING SUCCESS RESPONSE ---");
    return res.json({
      ok: true,
      tx: sent.transactionHash,
      sent_eth: Number(finalWei) / 1e18,
      gas_eth: Number(gasCost) / 1e18,
      max_before: maxEth,
      debug: {
        logs: debugLogs.slice(-50), // Last 50 logs
        block: sent.blockNumber,
        gas_used: sent.gasUsed
      }
    });

  } catch (e) {
    console.log("\n=== FATAL ERROR ===");
    console.log("[ERROR] Name:", e.name);
    console.log("[ERROR] Message:", e.message);
    console.log("[ERROR] Stack:", e.stack);
    console.log("[ERROR] Full error:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
    
    // Return error with debug info
    return res.json({ 
      ok: false, 
      error: e.message,
      debug: {
        logs: debugLogs.slice(-100), // Last 100 logs
        error_type: e.name,
        timestamp: new Date().toISOString()
      }
    });
  } finally {
    // Restore original console.log
    console.log = originalLog;
    console.log("\n========================================");
    console.log("=== REQUEST COMPLETE ===");
    console.log("========================================\n");
  }
}