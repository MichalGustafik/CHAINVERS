console.log("=== BOOT: CHAINVERS chaingetcashdraw.js ===");

import Web3 from "web3";
import axios from "axios";

/* ============================================================
   SAFE BODY PARSER (Vercel)
============================================================ */
async function parseBody(req) {
  return new Promise(resolve => {
    try {
      let raw = "";
      req.on("data", c => raw += c);
      req.on("end", () => {
        try { resolve(JSON.parse(raw || "{}")); }
        catch { resolve({}); }
      });
    } catch {
      resolve({});
    }
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
    } catch (e) {
      console.log("[RPC FAIL]", rpc, e.message);
    }
  }
  throw new Error("No working RPC");
}

/* ============================================================
   ABI – originBalance + backendCreditOrigin + withdrawOrigin
============================================================ */
const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "name":"originBalance",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[
      {"internalType":"uint256","name":"id","type":"uint256"},
      {"internalType":"uint256","name":"amt","type":"uint256"}
    ],
    "name":"backendCreditOrigin",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawOrigin",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

/* ============================================================
   FILTER ORDERS → UNIKÁTNE NFT
============================================================ */
function filterOrders(raw, user) {
  const byId = {};

  for (const o of raw || []) {
    try {
      const ua = (o.user_address || "").toLowerCase();
      if (ua && user && ua !== user.toLowerCase()) continue;

      if (o.token_id == null) continue;
      const tid = parseInt(o.token_id);
      if (!tid || tid <= 0) continue;

      const cs = o.chain_status || "";
      // toleruj paid / in_chain / paid emoji
      if (!cs) continue;

      // posledný záznam vyhráva
      const gain = Number(o.contract_gain ?? 0);

      byId[tid] = {
        token_id: tid,
        contract_gain: isNaN(gain) ? 0 : gain,
        chain_status: cs
      };
    } catch {}
  }

  return Object.values(byId);
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

  console.log("=== API CALL chaingetcashdraw ===");

  const body  = await parseBody(req);
  const q     = req.query || {};
  const action = body.action || q.action || "none";

  console.log("ACTION:", action);

  try {
    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);
    console.log("OWNER:", owner.address);

    /* --------------------------------------------------------
       ACTION: balanceOrigin
       GET /api/chaingetcashdraw?action=balanceOrigin&id=309
    -------------------------------------------------------- */
    if (action === "balanceOrigin") {
      const id = parseInt(q.id || body.id || 0);
      console.log("[BALANCE] id =", id);

      if (!id) return res.json({ ok:false, error:"Missing id" });

      const balWei = await contract.methods.originBalance(id).call();
      console.log("[BALANCE] originBalance =", balWei, "wei");

      return res.json({ ok:true, id, balance: balWei });
    }

    /* --------------------------------------------------------
       ACTION: sync
       POST { action:"sync", user:"0x..." }
       - načíta orders z InfinityFree
       - zistí diff (local > onchain) → backendCreditOrigin
    -------------------------------------------------------- */
    if (action === "sync") {
      const user = body.user || q.user;
      if (!user) return res.json({ ok:false, error:"No user" });

      const base = process.env.INF_FREE_URL || "https://chainvers.free.nf";
      const url  = `${base.replace(/\/+$/,"")}/get_orders_raw.php?user=${encodeURIComponent(user)}`;

      console.log("[SYNC] Loading orders:", url);
      const resp  = await axios.get(url, { timeout: 8000 });
      const raw   = resp.data || [];
      console.log("[SYNC] Raw orders count:", Array.isArray(raw) ? raw.length : "N/A");

      const orders = filterOrders(raw, user);
      console.log("[SYNC] Filtered NFT count:", orders.length);

      const results = [];

      for (const o of orders) {
        const tid = o.token_id;
        const localGain = Number(o.contract_gain || 0);
        if (!localGain || localGain <= 0) continue;

        const localWei = BigInt(Math.round(localGain * 1e18));
        const chainWei = BigInt(await contract.methods.originBalance(tid).call());

        if (localWei > chainWei) {
          const diff = localWei - chainWei;
          console.log(`[SYNC] Token ${tid}: local ${localWei}, chain ${chainWei}, adding diff ${diff}`);

          const method = contract.methods.backendCreditOrigin(tid, diff.toString());
          const gas = await method.estimateGas({ from: owner.address });

          const txData = {
            from: owner.address,
            to:   contractAddr,
            gas,
            data: method.encodeABI()
          };

          const signed = await web3.eth.accounts.signTransaction(txData, process.env.PRIVATE_KEY);
          const sent   = await web3.eth.sendSignedTransaction(signed.rawTransaction);

          results.push({
            token_id: tid,
            added_wei: diff.toString(),
            tx: sent.transactionHash
          });
        }
      }

      return res.json({ ok:true, synced: results });
    }

    /* --------------------------------------------------------
       ACTION: withdrawOrigin
       POST { action:"withdrawOrigin", tokenId: 309 }
       - volá withdrawOrigin(id) z owner adresy
    -------------------------------------------------------- */
    if (action === "withdrawOrigin") {
      const tokenId = parseInt(body.tokenId || 0);
      console.log("[WITHDRAW ORIGIN] id =", tokenId);

      if (!tokenId) return res.json({ ok:false, error:"Missing tokenId" });

      const method = contract.methods.withdrawOrigin(tokenId);

      let gas;
      try {
        gas = await method.estimateGas({ from: owner.address });
      } catch (e) {
        console.log("[GAS ERROR]", e.message);
        return res.json({ ok:false, error:"Gas estimation failed: "+e.message });
      }

      const txData = {
        from: owner.address,
        to:   contractAddr,
        gas,
        data: method.encodeABI()
      };

      const signed = await web3.eth.accounts.signTransaction(txData, process.env.PRIVATE_KEY);
      const sent   = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      console.log("[WITHDRAW ORIGIN] TX:", sent.transactionHash);
      return res.json({ ok:true, tx: sent.transactionHash });
    }

    return res.json({ ok:false, error:"Unknown action" });

  } catch (e) {
    console.log("[FATAL]", e.message);
    return res.json({ ok:false, error:e.message });
  }
}