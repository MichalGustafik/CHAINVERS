console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (FINAL LIVE) ===");

import Web3 from "web3";
import axios from "axios";

export const maxDuration = 60;

/* ============================================================
   SAFE BODY PARSER
============================================================ */
async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (e) {
        console.log("[BODY PARSE FAIL]", raw);
        resolve({});
      }
    });
  });
}

/* ============================================================
   LOG COLLECTOR
============================================================ */
function mkLog() {
  const rows = [];
  function push(...args) {
    const line = args.map(v => {
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    }).join(" ");
    const msg = `[${new Date().toISOString()}] ${line}`;
    rows.push(msg);
    console.log(msg);
  }
  return { push, rows };
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

async function initWeb3(log) {
  for (const r of RPCS) {
    try {
      const w = new Web3(r);
      const bn = await w.eth.getBlockNumber();
      log.push("[RPC OK]", r, "BLOCK", bn);
      return w;
    } catch (e) {
      log.push("[RPC FAIL]", r, e.message || String(e));
    }
  }
  throw new Error("NO_RPC_AVAILABLE");
}

/* ============================================================
   ABI – BACKEND WITHDRAW ONLY
============================================================ */
const ABI = [{
  inputs:[
    {internalType:"address",name:"to",type:"address"},
    {internalType:"uint256",name:"amount",type:"uint256"}
  ],
  name:"backendWithdraw",
  outputs:[],
  stateMutability:"nonpayable",
  type:"function"
}];

/* ============================================================
   HELPERS
============================================================ */
function normalizeUser(u) {
  return String(u || "").trim().toLowerCase();
}

/* ============================================================
   LOAD ORDERS
============================================================ */
async function loadOrders(user, log){
  const base = process.env.INF_FREE_URL || "https://chainvers.free.nf";
  const url = `${base.replace(/\/+$/, "")}/chaindraw.php?api=get_orders_raw&user=${encodeURIComponent(user)}`;

  log.push("[ORDERS FETCH]", url);

  const r = await axios.get(url, {
    timeout: 15000,
    responseType: "text",
    transformResponse: [data => data]
  });

  if (Array.isArray(r.data)) {
    log.push("[ORDERS FETCH OK ARRAY] COUNT", r.data.length);
    return r.data;
  }

  if (typeof r.data === "string") {
    const raw = r.data.trim();
    log.push("[ORDERS FETCH STRING LEN]", raw.length);
    log.push("[ORDERS FETCH STRING PREVIEW]", raw.slice(0, 300));

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        log.push("[ORDERS PARSED FROM STRING] COUNT", parsed.length);
        return parsed;
      }
      log.push("[ORDERS PARSED BUT NOT ARRAY]", typeof parsed);
      return [];
    } catch (e) {
      log.push("[ORDERS JSON PARSE FAIL]", e.message);
      return [];
    }
  }

  log.push("[ORDERS FETCH NON-ARRAY]", typeof r.data);
  return [];
}

/* ============================================================
   SUM AVAILABLE
============================================================ */
function sumAvailableOrders(orders, user, tokenId, log) {
  let maxEth = 0;
  let countMatched = 0;

  for (const o of orders) {
    if (!o || !o.user_address) continue;
    if (String(o.user_address).toLowerCase() !== user.toLowerCase()) continue;

    const orderTokenId = Number(o.token_id || 0);
    if (!orderTokenId) continue;
    if (Number(tokenId) !== orderTokenId) continue;

    const gainRaw = o.contract_gain ?? 0;
    const gain = Number(String(gainRaw).replace(",", "."));
    if (!Number.isFinite(gain) || gain <= 0) continue;

    countMatched++;
    maxEth += gain;
  }

  log.push("[MATCHED ORDERS]", countMatched);
  log.push("[MAX FROM ORDERS ETH]", maxEth);
  return maxEth;
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  if(req.method==="OPTIONS") return res.end();

  const log = mkLog();
  log.push("=== API CALL: chaingetcashdraw ===");
  log.push("[METHOD]", req.method);

  try{
    const body = await parseBody(req);

    log.push("[BODY]", body);
    log.push("[QUERY]", req.query || {});

    const user = normalizeUser(
      body.user ||
      req.query?.user ||
      req.headers["x-user"]
    );

    const amountRaw =
      body.amount ||
      req.query?.amount ||
      req.headers["x-amount"];

    const reqEth = Number(amountRaw);

    const tokenId =
      body.token_id ||
      req.query?.token_id ||
      req.headers["x-token-id"] ||
      null;

    log.push("[REQ USER]", user);
    log.push("[REQ AMOUNT RAW]", amountRaw);
    log.push("[REQ AMOUNT NUM]", reqEth);
    log.push("[REQ TOKEN ID]", tokenId);

    if(!user){
      log.push("[FAIL] NO USER");
      return res.json({ok:false,error:"bad_input_user",logs:log.rows});
    }

    if(!tokenId || Number(tokenId) <= 0){
      log.push("[FAIL] BAD TOKEN ID");
      return res.json({ok:false,error:"bad_input_token_id",logs:log.rows});
    }

    if(!reqEth || reqEth <= 0){
      log.push("[FAIL] BAD AMOUNT");
      return res.json({ok:false,error:"bad_input_amount",logs:log.rows});
    }

    const orders = await loadOrders(user, log);
    const maxEth = sumAvailableOrders(orders, user, tokenId, log);

    const web3 = await initWeb3(log);
    const contractAddr = process.env.CONTRACT_ADDRESS;
    if (!contractAddr) {
      log.push("[FAIL] MISSING CONTRACT_ADDRESS");
      return res.json({ok:false,error:"missing_contract_address",logs:log.rows});
    }

    if (!process.env.PRIVATE_KEY) {
      log.push("[FAIL] MISSING PRIVATE_KEY");
      return res.json({ok:false,error:"missing_private_key",logs:log.rows});
    }

    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    );
    web3.eth.accounts.wallet.add(owner);

    log.push("[OWNER]", owner.address);
    log.push("[CONTRACT]", contractAddr);

    if(reqEth > maxEth){
      log.push("[DENY] EXCEEDS BALANCE", "REQ", reqEth, "MAX", maxEth);
      return res.json({ok:false,error:"exceeds_balance",max:maxEth,logs:log.rows});
    }

    const grossWei = web3.utils.toWei(reqEth.toString(),"ether");
    log.push("[GROSS WEI]", grossWei);

    const method = contract.methods.backendWithdraw(user, grossWei);
    const gasLimit = await method.estimateGas({from: owner.address});

    const block = await web3.eth.getBlock("latest");
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : BigInt(web3.utils.toWei("0.0000005","ether"));
    const maxFeePerGas = baseFee * 2n;
    const priorityFee = BigInt(web3.utils.toWei("0.0000005","ether"));
    const gasCostWei = BigInt(gasLimit) * maxFeePerGas;

    log.push("[BLOCK NUMBER]", block?.number);
    log.push("[BASE FEE]", baseFee.toString());
    log.push("[GAS LIMIT]", gasLimit);
    log.push("[MAX FEE PER GAS]", maxFeePerGas.toString());
    log.push("[PRIORITY FEE]", priorityFee.toString());
    log.push("[GAS COST WEI]", gasCostWei.toString());

    const netWei = BigInt(grossWei) - gasCostWei;
    if(netWei <= 0n){
      log.push("[FAIL] TOO SMALL FOR GAS");
      return res.json({ok:false,error:"amount_too_small_for_gas",logs:log.rows});
    }

    log.push("[FINAL WEI]", netWei.toString());

    const tx = {
      from: owner.address,
      to: contractAddr,
      gas: gasLimit,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: priorityFee.toString(),
      data: contract.methods.backendWithdraw(
        user,
        netWei.toString()
      ).encodeABI()
    };

    log.push("[TX BUILD OK]", tx);

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      process.env.PRIVATE_KEY
    );

    log.push("[SIGNED TX READY]");

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    log.push("[TX OK]", sent.transactionHash);

    return res.json({
      ok:true,
      tx: sent.transactionHash,
      token_id: Number(tokenId),
      requested_eth: reqEth,
      sent_eth: web3.utils.fromWei(netWei.toString(),"ether"),
      gas_paid_by_backend: web3.utils.fromWei(gasCostWei.toString(),"ether"),
      max_available_eth: maxEth,
      logs: log.rows
    });

  }catch(e){
    log.push("[FATAL]", e?.message || String(e));
    if (e?.stack) log.push("[STACK]", e.stack);

    return res.json({
      ok:false,
      error:e?.message || "unknown_error",
      logs: log.rows
    });
  }
}