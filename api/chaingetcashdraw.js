console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (FINAL) ===");

import Web3 from "web3";
import axios from "axios";

/* ============================================================
   SAFE BODY PARSER
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
const RPCS = [
  process.env.PROVIDER_URL,
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://rpc.ankr.com/base"
].filter(Boolean);

async function initWeb3() {
  for (const r of RPCS) {
    try {
      const w = new Web3(r);
      await w.eth.getBlockNumber();
      console.log("[RPC OK]", r);
      return w;
    } catch {}
  }
  throw new Error("No RPC");
}

/* ============================================================
   ABI – BACKEND WITHDRAW ONLY
============================================================ */
const ABI = [{
  "inputs":[
    {"internalType":"address","name":"to","type":"address"},
    {"internalType":"uint256","name":"amount","type":"uint256"}
  ],
  "name":"backendWithdraw",
  "outputs":[],
  "stateMutability":"nonpayable",
  "type":"function"
}];

/* ============================================================
   LOAD USER ORDERS (SOURCE OF TRUTH)
============================================================ */
async function loadOrders(user) {
  const base = process.env.INF_FREE_URL;
  const url  = `${base}/get_orders_raw.php?user=${encodeURIComponent(user)}`;
  const r = await axios.get(url, { timeout: 8000 });
  return Array.isArray(r.data) ? r.data : [];
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();

  console.log("=== API CALL: withdraw ===");

  try {
    const body = await parseBody(req);
    const user = body.user;
    const reqEth = Number(body.amount);

    if (!user || !reqEth || reqEth <= 0)
      return res.json({ ok:false, error:"bad_input" });

    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    console.log("[OWNER]", owner.address);
    console.log("[WITHDRAW] requested:", reqEth, "ETH");

    /* ========================================================
       CALCULATE USER MAX FROM ORDERS
    ======================================================== */
    const orders = await loadOrders(user);
    let maxEth = 0;

    for (const o of orders) {
      if (o.user_address?.toLowerCase() !== user.toLowerCase()) continue;
      if (!o.contract_gain) continue;
      maxEth += Number(o.contract_gain);
    }

    if (reqEth > maxEth)
      return res.json({ ok:false, error:"exceeds_balance", max:maxEth });

    /* ========================================================
       GAS ESTIMATION
    ======================================================== */
    const grossWei = web3.utils.toWei(reqEth.toString(), "ether");

    const method = contract.methods.backendWithdraw(
      user,
      grossWei
    );

    const gasLimit = await method.estimateGas({ from: owner.address });
    const block = await web3.eth.getBlock("latest");

    const maxFeePerGas = block.baseFeePerGas * 2n;
    const gasCostWei = BigInt(gasLimit) * BigInt(maxFeePerGas);

    console.log("[GAS COST WEI]", gasCostWei.toString());

    const netWei = BigInt(grossWei) - gasCostWei;
    if (netWei <= 0n)
      return res.json({ ok:false, error:"amount_too_small_for_gas" });

    console.log("[FINAL WEI TO SEND]", netWei.toString());

    /* ========================================================
       SEND TX (⚠️ NO VALUE!)
    ======================================================== */
    const tx = {
      from: owner.address,
      to: contractAddr,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: web3.utils.toWei("0.0000005", "ether"),
      data: contract.methods.backendWithdraw(
        user,
        netWei.toString()
      ).encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    console.log("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      sent_eth: web3.utils.fromWei(netWei.toString(), "ether"),
      gas_paid_by_backend: web3.utils.fromWei(gasCostWei.toString(), "ether")
    });

  } catch (e) {
    console.log("[FATAL]", e.message);
    return res.json({ ok:false, error:e.message });
  }
}