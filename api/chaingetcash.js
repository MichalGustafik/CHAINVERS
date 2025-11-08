import Web3 from "web3";
import fetch from "node-fetch";
import fs from "fs";

const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
let INF_FREE_URL   = process.env.INF_FREE_URL?.replace(/\/$/, "") || "";
const CHAINVERS_KEY= process.env.CHAINVERS_KEY || "";
const BALANCE_ADDRESS = process.env.BALANCE_ADDRESS || FROM;

const web3 = new Web3(PROVIDER_URL);
const ABI = [{
  type:"function", name:"fundTokenFor",
  inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]
}];

export const config = { api: { bodyParser:true } };

async function sendLog(msg){
  if(!INF_FREE_URL) return;
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${msg}`})
    });
  }catch(e){console.error("log fail",e.message);}
}
const log=async(...a)=>{console.log(a.join(" "));await sendLog(a.join(" "));};

// autodetect InfinityFree
async function detectInfinityURL(){
  if(INF_FREE_URL?.startsWith("http")){
    await log(`🌐 Používam INF_FREE_URL = ${INF_FREE_URL}`);return INF_FREE_URL;
  }
  const urls=["https://chainvers.free.nf","https://chainvers.infinityfreeapp.com"];
  for(const url of urls){
    try{
      const r=await fetch(`${url}/api_refresh.php`,{method:"GET"});
      if(r.ok){INF_FREE_URL=url;await log(`🌐 Autodetekcia INF_FREE_URL = ${url}`);return url;}
    }catch(e){console.log("skip",url,e.message);}
  }
  throw new Error("Nedá sa zistiť INF_FREE_URL");
}

// helpers
async function getEurEthRate(){try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");const j=await r.json();await log(`💱 1 ETH = ${j.ethereum.eur} EUR`);return j.ethereum.eur;}catch{await log("⚠️ CoinGecko fail 2500 EUR");return 2500;}}
async function getGasPrice(){const gp=await web3.eth.getGasPrice();await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;}
async function getBalanceEth(addr){const w=await web3.eth.getBalance(addr);return Number(web3.utils.fromWei(w,"ether"));}

// get orders from InfinityFree proxy
async function fetchOrdersFromIF(){
  if(!INF_FREE_URL) await detectInfinityURL();
  const resp=await fetch(`${INF_FREE_URL}/api_refresh.php`,{
    method:"GET",headers:{
      "User-Agent":"CHAINVERS/1.0",
      "X-CHAINVERS-KEY":CHAINVERS_KEY
    }
  });
  if(!resp.ok) throw new Error(`IF refresh failed: ${resp.status}`);
  const list=await resp.json();
  return Array.isArray(list)?list.filter(o=>o.status!=="💰 Zaplatené"&&o.token_id):[];
}

// mark paid
async function markOrderPaid(order_id,tx_hash,user_addr){
  if(!INF_FREE_URL) await detectInfinityURL();
  const headers={"Content-Type":"application/x-www-form-urlencoded"};
  if(CHAINVERS_KEY) headers["X-CHAINVERS-KEY"]=CHAINVERS_KEY;
  const url=`${INF_FREE_URL}/accptpay.php?action=update_order`;
  await fetch(url,{method:"POST",headers,body:new URLSearchParams({order_id,tx_hash,user_addr})});
  await log(`📝 update_order: ${order_id}`);
}

// send ETH
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
    chainId:await web3.eth.getChainId(),
  };
  const signed=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
  const receipt=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX done: ${receipt.transactionHash}`);
  return receipt;
}

// main handler
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");
    await detectInfinityURL();
    const [eur,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    const bal=await getBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance ${BALANCE_ADDRESS}: ${bal} ETH`);
    const orders=await fetchOrdersFromIF();
    if(orders.length===0){await log("ℹ️ Žiadne čakajúce objednávky");return res.json({ok:true,balance_eth:bal,funded_count:0});}

    let funded=0;
    for(const o of orders){
      const user=o.user_address,tid=Number(o.token_id);
      if(!user||!tid) continue;
      const amt=(+o.amount||0)/eur||0.0001;
      if(bal<amt){await log("⚠️ Nedostatok ETH");break;}
      const r=await sendEthToNFT({user_addr:user,token_id:tid,ethAmount:amt,gasPrice:gas});
      funded++;await markOrderPaid(o.paymentIntentId||tid,r.transactionHash,user);
    }
    await log(`✅ FUND DONE funded=${funded}`);
    res.json({ok:true,balance_eth:bal,funded_count:funded});
  }catch(e){await log(`❌ ERROR: ${e.message}`);res.status(500).json({ok:false,error:e.message});}
}