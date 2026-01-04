console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (ROBUST) ===");

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
    } catch (e) {
      console.log("[RPC FAIL]", r);
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
   LOAD ORDERS
============================================================ */
async function loadOrders(user){
  const base = process.env.INF_FREE_URL;
  const url = `${base}/get_orders_raw.php?user=${encodeURIComponent(user)}`;

  console.log("[ORDERS FETCH]", url);
  const r = await axios.get(url, { timeout: 10000 });

  return Array.isArray(r.data) ? r.data : [];
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  if(req.method==="OPTIONS") return res.end();

  console.log("=== API CALL: withdraw ===");

  try{
    const body = await parseBody(req);

    console.log("[BODY]", body);
    console.log("[QUERY]", req.query);

    const user =
      body.user ||
      req.query?.user ||
      req.headers["x-user"];

    const amountRaw =
      body.amount ||
      req.query?.amount ||
      req.headers["x-amount"];

    const reqEth = Number(amountRaw);

    console.log("[REQ USER]", user);
    console.log("[REQ AMOUNT RAW]", amountRaw);
    console.log("[REQ AMOUNT NUM]", reqEth);

    if(!user || !reqEth || reqEth <= 0){
      console.log("[FAIL] BAD INPUT");
      return res.json({ok:false,error:"bad_input"});
    }

    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    );
    web3.eth.accounts.wallet.add(owner);

    console.log("[OWNER]", owner.address);

    const orders = await loadOrders(user);
    console.log("[ORDERS COUNT]", orders.length);

    let maxEth = 0;
    for(const o of orders){
      if(o.user_address?.toLowerCase() !== user.toLowerCase()) continue;
      if(!o.contract_gain) continue;
      maxEth += Number(o.contract_gain);
    }

    console.log("[MAX FROM ORDERS]", maxEth);

    if(reqEth > maxEth){
      console.log("[DENY] EXCEEDS BALANCE");
      return res.json({ok:false,error:"exceeds_balance",max:maxEth});
    }

    const grossWei = web3.utils.toWei(reqEth.toString(),"ether");
    const method = contract.methods.backendWithdraw(user, grossWei);
    const gasLimit = await method.estimateGas({from: owner.address});

    const block = await web3.eth.getBlock("latest");
    const maxFeePerGas = BigInt(block.baseFeePerGas) * 2n;
    const gasCostWei = BigInt(gasLimit) * maxFeePerGas;

    console.log("[GAS LIMIT]", gasLimit);
    console.log("[GAS COST WEI]", gasCostWei.toString());

    const netWei = BigInt(grossWei) - gasCostWei;
    if(netWei <= 0n){
      console.log("[FAIL] TOO SMALL FOR GAS");
      return res.json({ok:false,error:"amount_too_small_for_gas"});
    }

    console.log("[FINAL WEI]", netWei.toString());

    const tx = {
      from: owner.address,
      to: contractAddr,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: web3.utils.toWei("0.0000005","ether"),
      data: contract.methods.backendWithdraw(
        user,
        netWei.toString()
      ).encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      process.env.PRIVATE_KEY
    );

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    console.log("[TX OK]", sent.transactionHash);

    return res.json({
      ok:true,
      tx: sent.transactionHash,
      sent_eth: web3.utils.fromWei(netWei.toString(),"ether"),
      gas_paid_by_backend: web3.utils.fromWei(gasCostWei.toString(),"ether")
    });

  }catch(e){
    console.log("[FATAL]", e);
    return res.json({ok:false,error:e.message});
  }
}