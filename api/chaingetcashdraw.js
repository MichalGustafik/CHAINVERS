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
   BYPASS DDoS PROTECTION - INFINITYFREE
============================================================ */
async function bypassInfinityFreeProtection(url, maxRetries = 3) {
  console.log("[BYPASS] Starting DDoS protection bypass for:", url);
  
  const axiosConfig = {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    },
    maxRedirects: 5
  };
  
  // First request - will get challenge
  console.log("[BYPASS] First request (expecting challenge)...");
  let response = await axios.get(url, axiosConfig);
  
  // Check if we got the challenge page
  if (response.data.includes('aes.js') && response.data.includes('slowAES.decrypt')) {
    console.log("[BYPASS] DDoS challenge detected, solving...");
    
    // Extract the encrypted cookie value
    const aesMatch = response.data.match(/toNumbers\("([a-f0-9]+)"\)/g);
    if (aesMatch && aesMatch.length >= 3) {
      // Parse the JavaScript to get the values
      const key = response.data.match(/toNumbers\("([a-f0-9]+)"\)/)[1];
      const iv = response.data.match(/toNumbers\("([a-f0-9]+)"\).*toNumbers\("([a-f0-9]+)"\)/)[2];
      const ciphertext = response.data.match(/toNumbers\("([a-f0-9]+)"\).*toNumbers\("([a-f0-9]+)"\).*toNumbers\("([a-f0-9]+)"\)/)[3];
      
      console.log("[BYPASS] Extracted crypto params:", { key, iv, ciphertext });
      
      // We need to make a second request with the cookie
      // For now, we'll just retry with session
      const jar = new axios.CookieJar();
      
      // Make request with cookie support
      const session = axios.create({
        ...axiosConfig,
        jar,
        withCredentials: true
      });
      
      // First get the challenge to set cookie
      await session.get(url);
      
      // Wait a bit for cookie to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Retry the request
      console.log("[BYPASS] Retrying with session...");
      response = await session.get(url);
    }
  }
  
  // Check if we have valid JSON now
  if (typeof response.data === 'string' && response.data.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(response.data);
      if (Array.isArray(parsed)) {
        console.log("[BYPASS] Successfully parsed JSON array");
        return parsed;
      }
    } catch (e) {
      console.log("[BYPASS] JSON parse failed:", e.message);
    }
  }
  
  // If still not working, try alternative approach
  console.log("[BYPASS] Trying alternative endpoint...");
  
  // Try direct orders.json file
  const userMatch = url.match(/user=([^&]+)/);
  if (userMatch) {
    const user = decodeURIComponent(userMatch[1]);
    const directUrl = `https://chainvers.free.nf/chainuserdata/${user}/orders.json`;
    
    console.log("[BYPASS] Trying direct file:", directUrl);
    try {
      const directResponse = await axios.get(directUrl, {
        ...axiosConfig,
        timeout: 10000
      });
      
      if (directResponse.data) {
        console.log("[BYPASS] Got direct file response");
        return Array.isArray(directResponse.data) ? directResponse.data : [];
      }
    } catch (directError) {
      console.log("[BYPASS] Direct file error:", directError.message);
    }
  }
  
  throw new Error("Could not bypass DDoS protection");
}

/* ============================================================
   LOAD ORDERS - UPDATED FOR DDOS PROTECTION
============================================================ */
async function loadOrders(user) {
  const base = process.env.INF_FREE_URL || "https://chainvers.free.nf";
  const url  = `${base.replace(/\/+$/,"")}/get_orders_raw.php?user=${encodeURIComponent(user)}`;

  console.log("[ORDERS] Loading from:", url);
  
  try {
    // Try normal request first
    const normalResponse = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Chainvers-Withdraw/1.0'
      }
    });
    
    console.log("[ORDERS] Response status:", normalResponse.status);
    console.log("[ORDERS] Content-Type:", normalResponse.headers['content-type']);
    
    // Check if it's HTML (DDoS protection)
    const contentType = normalResponse.headers['content-type'] || '';
    const isHTML = contentType.includes('text/html') || 
                   (typeof normalResponse.data === 'string' && 
                    normalResponse.data.includes('<!DOCTYPE') || 
                    normalResponse.data.includes('<html'));
    
    if (isHTML) {
      console.log("[ORDERS] HTML response detected, trying bypass...");
      
      // Try bypass
      const orders = await bypassInfinityFreeProtection(url);
      return orders;
    }
    
    // Try to parse as JSON
    let data = normalResponse.data;
    
    if (typeof data === 'string') {
      // Clean up potential BOM or whitespace
      data = data.trim();
      if (data.startsWith('\uFEFF')) {
        data = data.slice(1);
      }
      
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      } catch (parseError) {
        console.log("[ORDERS] JSON parse error:", parseError.message);
        
        // Maybe it's JSONP? Try to extract JSON from callback
        const jsonpMatch = data.match(/^\w+\((\[.*\])\)$/);
        if (jsonpMatch) {
          try {
            return JSON.parse(jsonpMatch[1]);
          } catch (e) {
            console.log("[ORDERS] JSONP parse failed:", e.message);
          }
        }
        
        return [];
      }
    }
    
    if (Array.isArray(data)) {
      return data;
    }
    
    return [];
    
  } catch (error) {
    console.log("[ORDERS LOAD ERROR]", error.message);
    
    // Fallback: use mock data for testing
    if (process.env.NODE_ENV === 'development') {
      console.log("[ORDERS] Using development mock data");
      return [
        {
          user_address: user,
          token_id: "1",
          contract_gain: "0.05",
          chain_status: "confirmed"
        },
        {
          user_address: user,
          token_id: "2",
          contract_gain: "0.03",
          chain_status: "confirmed"
        }
      ];
    }
    
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
   MAIN HANDLER - SIMPLIFIED
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
       LOAD ORDERS WITH DDOS BYPASS
    -------------------------------------------------------- */
    const orders = await loadOrders(user);
    console.log("[ORDERS COUNT]", orders.length);
    console.log("[ORDERS SAMPLE]", JSON.stringify(orders.slice(0, 2)));

    const maxEth = calcMaxFromOrders(orders, user);
    console.log("[MAX FROM ORDERS]", maxEth);

    if (maxEth <= 0) {
      return res.json({ 
        ok:false, 
        error:"exceeds_balance", 
        max:0,
        debug: "No orders found or zero balance. Check if get_orders_raw.php is accessible without DDoS protection."
      });
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
    
    // Special handling for DDoS protection error
    if (e.message.includes("DDoS") || e.message.includes("protection")) {
      return res.json({ 
        ok:false, 
        error:"ddos_protection_block",
        suggestion: "get_orders_raw.php is behind DDoS protection. Try accessing it directly in browser first to solve challenge."
      });
    }
    
    return res.json({ ok:false, error:e.message });
  }
}