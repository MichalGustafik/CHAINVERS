import Web3 from "web3";
import fetch from "node-fetch";
import fs from "fs";

const PROVIDER_URL   = process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FROM           = process.env.FROM_ADDRESS;
const CONTRACT       = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
let   INF_FREE_URL   = process.env.INF_FREE_URL?.replace(/\/$/, "") || "";
const CHAINVERS_KEY  = process.env.CHAINVERS_KEY || "";
const BALANCE_ADDRESS= process.env.BALANCE_ADDRESS || FROM;
const MINT_MIN_ETH   = Number(process.env.MINT_MIN_ETH ?? "0.0001");
const web3 = new Web3(PROVIDER_URL);

const ABI = [{
  type:"function", name:"fundTokenFor",
  inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]
}];

export const config = { api: { bodyParser: true } };

// ===== Logovanie do IF =====
async function sendLog(message){
  if(!INF_FREE_URL) return;
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${message}`})
    });
  }catch(e){ console.error("log fail",e.message); }
}
const log = async (...a)=>{ const msg=a.join(" "); console.log(msg); await sendLog(msg); };

// ===== Autodetekcia InfinityFree URL =====
async function detectInfinityURL(){
  if(INF_FREE_URL && INF_FREE_URL.startsWith("http")){
    await log(`🌐 Používam INF_FREE_URL = ${INF_FREE_URL}`);
    return INF_FREE_URL;
  }
  const urls=["https://chainvers.free.nf","https://chainvers.infinityfreeapp.com"];
  for(const u of urls){
    try{
      const r=await fetch(`${u}/accptpay.php?action=read_log`,{method:"GET"});
      if(r.ok){ INF_FREE_URL=u; await log(`🌐 Autodetekcia INF_FREE_URL = ${u}`); return u; }
    }catch(e){}
  }
  throw new Error("Nedá sa zistiť INF_FREE_URL");
}

// ===== Helpery =====
async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();
    const rate=j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate||2500;
  }catch{ await log("⚠️ CoinGecko fail, fallback 2500"); return 2500; }
}
async function getGasPrice(){const gp=await web3.eth.getGasPrice();await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;}
async function getChainBalanceEth(a){const w=await web3.eth.getBalance(a);return Number(web3.utils.fromWei(w,"ether"));}

// ===== Bezpečný fetch objednávok =====
async function fetchOrdersFromIF(){
  if(!INF_FREE_URL) await detectInfinityURL();
  const body=new URLSearchParams({action:"refresh"});
  const headers={
    "Content-Type":"application/x-www-form-urlencoded",
    "User-Agent":"Mozilla/5.0 (CHAINVERS-Verifier)",
    "Origin":INF_FREE_URL
  };
  let resp;
  try{
    resp=await fetch(`${INF_FREE_URL}/accptpay.php`,{method:"POST",headers,body});
  }catch{ resp={ok:false,status:0}; }

  if(!resp.ok){
    await log(`⚠️ POST failed (${resp.status}), skúšam GET → /api_refresh.php`);
    const g=await fetch(`${INF_FREE_URL}/api_refresh.php`);
    if(!g.ok) throw new Error(`IF GET failed: ${g.status}`);
    const arr=await g.json();
    return Array.isArray(arr)?arr:[];
  }

  const list=await resp.json();
  if(!Array.isArray(list)) throw new Error("orders invalid");
  return list.filter(o=>o.status!=="💰 Zaplatené" && o.token_id);
}

// ===== Update objednávky po úspechu =====
async function markOrderPaid(order_id,tx_hash,user_addr){
  if(!INF_FREE_URL) await detectInfinityURL();
  const headers={"Content-Type":"application/x-www-form-urlencoded"};
  if(CHAINVERS_KEY) headers["X-CHAINVERS-KEY"]=CHAINVERS_KEY;
  await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
    method:"POST",headers,
    body:new URLSearchParams({order_id,tx_hash,user_addr})
  });
  await log(`📝 update_order ${order_id} TX ${tx_hash}`);
}

// ===== Odoslanie ETH do NFT =====
async function sendEthToNFT({user_addr,token_id,ethAmount,gasPrice}){
  const contract=new web3.eth.Contract(ABI,CONTRACT);
  const valueWei=web3.utils.toWei(String(ethAmount),"ether");
  const gasLimit=await contract.methods.fundTokenFor(user_addr,token_id).estimateGas({from:FROM,value:valueWei});
  const tx={
    from:FROM,to:CONTRACT,value:valueWei,
    data:contract.methods.fundTokenFor(user_addr,token_id).encodeABI(),
    gas:web3.utils.toHex(gasLimit),
    gasPrice:web3.utils.toHex(gasPrice),
    nonce:await web3.eth.getTransactionCount(FROM,"pending"),
    chainId:await web3.eth.getChainId()
  };
  await log(`▶️ TX fundTokenFor(${user_addr},${token_id}) ${ethAmount} ETH`);
  const signed=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
  const r=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  try{fs.appendFileSync("/tmp/fundtx.log",`${Date.now()} ${r.transactionHash}\n`);}catch{}
  await log(`✅ TX done: ${r.transactionHash}`);
  return r;
}

// ===== Hlavný handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");
    await detectInfinityURL();
    const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    const bal=await getChainBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance ${BALANCE_ADDRESS}: ${bal} ETH`);

    const orders=await fetchOrdersFromIF();
    if(orders.length===0){await log("ℹ️ Žiadne čakajúce objednávky");return res.json({ok:true,balance_eth:bal,funded_count:0});}

    let funded=0;
    for(const o of orders){
      const addr=o.user_address,tid=Number(o.token_id);
      if(!addr||!tid) continue;
      const eur=Number(o.amount??o.amount_eur??0);
      const ethAmt=eur>0?eur/rate:MINT_MIN_ETH;
      const receipt=await sendEthToNFT({user_addr:addr,token_id:tid,ethAmount:ethAmt,gasPrice:gas});
      funded++;await markOrderPaid(o.paymentIntentId||tid,receipt.transactionHash,addr);
    }
    await log(`✅ FUND DONE · funded=${funded}`);
    res.json({ok:true,balance_eth:bal,funded_count:funded});
  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}