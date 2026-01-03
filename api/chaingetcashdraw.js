console.log("=== BOOT: CHAINVERS chaingetcashdraw.js ===");

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
   RPC INIT
============================================================ */
async function initWeb3() {
  const rpcs = [
    process.env.PROVIDER_URL,
    "https://base.llamarpc.com",
    "https://rpc.ankr.com/base"
  ].filter(Boolean);

  for (const r of rpcs) {
    try {
      const w = new Web3(r);
      await w.eth.getBlockNumber();
      console.log("[RPC OK]", r);
      return w;
    } catch {
      console.log("[RPC FAIL]", r);
    }
  }
  throw new Error("NO RPC");
}

/* ============================================================
   ABI
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
   LOAD ORDERS (MERGED)
============================================================ */
async function loadOrders(user){
  const url = `${process.env.INF_FREE_URL || "https://chainvers.free.nf"}/chaindraw.php?user=${user}`;
  console.log("[ORDERS LOAD]", url);

  const r = await axios.get(url,{timeout:8000});
  return Array.isArray(r.data) ? r.data : [];
}

/* ============================================================
   CALC MAX
============================================================ */
function calcMax(raw,user){
  let sum=0;
  raw.forEach((o,i)=>{
    console.log("[ORDER]",i,o);
    if(!o.user_address) return;
    if(o.user_address.toLowerCase()!==user.toLowerCase()) return;

    let g=o.contract_gain;
    if(typeof g==="string") g=g.replace(",",".");

    g=Number(g);
    if(!isNaN(g)&&g>0) sum+=g;
  });
  return Math.floor(sum*1e18)/1e18;
}

/* ============================================================
   HANDLER
============================================================ */
export default async function handler(req,res){
  console.log("=== API CALL: withdraw ===");
  const body=await parseBody(req);
  const user=body.user;
  const amount=Number(body.amount||0);

  console.log("[REQ]",user,amount);

  if(!user||amount<=0){
    return res.json({ok:false,error:"bad_request"});
  }

  const orders=await loadOrders(user);
  console.log("[ORDERS COUNT]",orders.length);

  const max=calcMax(orders,user);
  console.log("[MAX FROM ORDERS]",max);

  if(amount>max){
    return res.json({ok:false,error:"exceeds_balance",max});
  }

  const web3=await initWeb3();
  const contract=new web3.eth.Contract(ABI,process.env.CONTRACT_ADDRESS);
  const owner=web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  web3.eth.accounts.wallet.add(owner);

  const wei=BigInt(Math.floor(amount*1e18));
  const method=contract.methods.backendWithdraw(user,wei.toString());

  const gas=await method.estimateGas({from:owner.address});
  const gasPrice=BigInt(await web3.eth.getGasPrice());
  const gasCost=BigInt(gas)*gasPrice;

  console.log("[GAS]",gasCost.toString());

  if(wei<=gasCost){
    return res.json({ok:false,error:"too_small_for_gas"});
  }

  const finalWei=wei-gasCost;
  console.log("[FINAL WEI]",finalWei.toString());

  const tx=await web3.eth.sendSignedTransaction(
    (await web3.eth.accounts.signTransaction({
      from:owner.address,
      to:process.env.CONTRACT_ADDRESS,
      gas,
      data:contract.methods.backendWithdraw(user,finalWei.toString()).encodeABI()
    },process.env.PRIVATE_KEY)).rawTransaction
  );

  console.log("[TX OK]",tx.transactionHash);

  res.json({
    ok:true,
    tx:tx.transactionHash,
    sent:Number(finalWei)/1e18,
    gas:Number(gasCost)/1e18
  });
}