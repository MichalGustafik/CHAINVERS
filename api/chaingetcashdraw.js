console.log("=== BOOT: ALWAYS-SYNC WITHDRAW BACKEND ===");

import Web3 from "web3";
import axios from "axios";

// ============================================================
// SAFE JSON PARSER FOR VERCEL
// ============================================================
async function parseBody(req) {
  return new Promise(resolve => {
    try {
      let raw = "";
      req.on("data", c => raw += c);
      req.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({}); }
      });
    } catch {
      resolve({});
    }
  });
}

// ============================================================
// RPC FALLBACK
// ============================================================
const PRIMARY = process.env.PROVIDER_URL;
const FALLBACKS = [
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://base.blockpi.network/v1/rpc/public",
  "https://rpc.ankr.com/base"
];

async function initWeb3() {
  const list = [PRIMARY, ...FALLBACKS];
  for (let rpc of list) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("[RPC] OK:", rpc);
      return w3;
    } catch(e) {
      console.log("[RPC FAIL]", rpc, e.message);
    }
  }
  throw new Error("No working RPC");
}

// ============================================================
// ABI: originBalance + backendCreditOrigin + withdrawOrigin
// ============================================================
const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "name":"originBalance",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view","type":"function"
  },
  {
    "inputs":[
      {"internalType":"uint256","name":"id","type":"uint256"},
      {"internalType":"uint256","name":"amt","type":"uint256"}
    ],
    "name":"backendCreditOrigin",
    "outputs":[],
    "stateMutability":"nonpayable","type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawOrigin",
    "outputs":[],
    "stateMutability":"nonpayable","type":"function"
  }
];

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  console.log("=== API CALL (SYNC OR WITHDRAW) ===");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const body = await parseBody(req);
  const action = body.action || req.query.action;

  console.log("ACTION:", action);

  try {
    const web3 = await initWeb3();
    const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    // ========================================================
    // ACTION: SYNC
    // ========================================================
    if (action === "sync") {
      const user = body.user;
      if (!user) return res.json({ ok:false, error:"No user" });

      const ordersURL = `${process.env.INF_FREE_URL}/get_orders_raw.php?user=${user}`;
      console.log("Loading orders:", ordersURL);

      const orders = await axios.get(ordersURL).then(r => r.data);
      console.log("Orders loaded:", orders.length);

      const synced = [];

      for (const o of orders) {
        const tid = o.token_id;
        const gain = Number(o.contract_gain || 0);

        if (!gain || gain <= 0) continue;

        const localWei = BigInt(Math.floor(gain * 1e18));
        const chainWei = BigInt(await contract.methods.originBalance(tid).call());

        if (localWei > chainWei) {
          const diff = localWei - chainWei;

          console.log(`SYNC → Token ${tid}: add ${diff} wei`);

          const method = contract.methods.backendCreditOrigin(tid, diff);

          const gas = await method.estimateGas({ from: owner.address });

          const tx = {
            from: owner.address,
            to: process.env.CONTRACT_ADDRESS,
            gas,
            data: method.encodeABI()
          };

          const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
          const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

          synced.push({ tokenId: tid, addedWei: diff.toString(), tx: sent.transactionHash });
        }
      }

      return res.json({ ok:true, synced });
    }

    // ========================================================
    // ACTION: WITHDRAW
    // ========================================================
    if (action === "withdraw") {
      const { tokenId } = body;
      console.log("WITHDRAW token:", tokenId);

      const method = contract.methods.withdrawOrigin(tokenId);
      const gas = await method.estimateGas({ from: owner.address });

      const tx = {
        from: owner.address,
        to: process.env.CONTRACT_ADDRESS,
        gas,
        data: method.encodeABI()
      };

      const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.json({ ok:true, tx: sent.transactionHash });
    }

    return res.json({ ok:false, error:"Unknown action" });

  } catch (e) {
    console.log("FATAL:", e.message);
    return res.json({ ok:false, error:e.message });
  }
}