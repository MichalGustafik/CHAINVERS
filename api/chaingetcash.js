import Web3 from "web3";
import fetch from "node-fetch";
import fs from "fs";

const PROVIDER_URL   = process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FROM           = process.env.FROM_ADDRESS;
const CONTRACT       = process.env.CONTRACT_ADDRESS;
let   INF_FREE_URL   = process.env.INF_FREE_URL?.replace(/\/$/, "") || "https://chainvers.free.nf";
const CHAINVERS_KEY  = process.env.CHAINVERS_KEY || "";
const BALANCE_ADDRESS= process.env.BALANCE_ADDRESS || FROM;

const web3 = new Web3(PROVIDER_URL);
const ABI = [{
  type:"function", name:"fundTokenFor",
  inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]
}];

export const config = { api: { bodyParser:true } };

// ===== LOG to IF =====
async function sendLog(msg){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": INF_FREE_URL + "/accptpay.php"
      },
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${msg}`})
    });
  }catch(e){console.log("log fail",e.message);}
}
const log=async(...a)=>{const m=a.join(" ");console.log(m);await sendLog(m);};

// ===== Helpery =====
async function getEurEthRate(){
  try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();const rate=j?.ethereum?.eur;await log(`💱 1 ETH = ${rate} EUR`);return rate||2500;
  }catch{await log("⚠️ CoinGecko fail 2500");return 2500;}
}
async function getGasPrice(){const gp=await web3.eth.getGasPrice();await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;}
async function getChainBalanceEth(a){const w=await web3.eth.getBalance(a);return Number(web3.utils.fromWei(w,"ether"));}

// ===== FIX: robustný fetch objednávok =====
async function fetchOrdersFromIF(){
  const headers={
    "Content-Type":"application/x-www-form-urlencoded",
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language":"en-US,en;q=0.5",
    "Referer": INF_FREE_URL + "/accptpay.php",
    "Cookie":"PHPSESSID=fakeSession123"
  };

  // najskôr sa pokús o POST ako prehliadač
  try {
    const resp = await fetch(`${INF_FREE_URL}/accptpay.php`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ action: "refresh" }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) return data.filter(o => o.token_id && o.status !== "💰 Zaplatené");
    }
    await log(`⚠️ POST failed (${resp.status}), skúšam GET`);
  } catch (e) {
    await log("⚠️ POST fetch error: " + e.message);
  }

  // fallback na GET (väčšina IF ho pustí)
  try {
    const g = await fetch(`${INF_FREE_URL}/accptpay.php?action=refresh`, {
      method: "GET",
      headers,
    });
    if (g.ok) {
      const data = await g.json();
      if (Array.isArray(data)) return data.filter(o => o.token_id && o.status !== "💰 Zaplatené");
    }
    throw new Error(`GET failed ${g.status}`);
  } catch (e) {
    throw new Error("IF refresh failed: " + e.message);
  }
}

// ===== UPDATE objednávky =====
async function markOrderPaid(order_id,tx_hash,user_addr){
  await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    },
    body:new URLSearchParams({order_id,tx_hash,user_addr})
  });
  await log(`📝 update_order ${order_id}`);
}

// ===== TX =====
async function sendEthToNFT({user_addr,token_id,ethAmount,gasPrice}){
  const c=new web3.eth.Contract(ABI,CONTRACT);
  const wei=web3.utils.toWei(String(ethAmount),"ether");
  const gasLimit=await c.methods.fundTokenFor(user_addr,token_id).estimateGas({from:FROM,value:wei});
  const tx={
    from:FROM,to:CONTRACT,value:wei,
    data:c.methods.fundTokenFor(user_addr,token_id).encodeABI(),
    gas:web3.utils.toHex(gasLimit),
    gasPrice:web3.utils.toHex(gasPrice),
    nonce:await web3.eth.getTransactionCount(FROM,"pending"),
    chainId:await web3.eth.getChainId(),
  };
  const signed=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
  const r=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  try{fs.appendFileSync("/tmp/fundtx.log",`${Date.now()} ${r.transactionHash}\n`);}catch{}
  await log(`✅ TX: ${r.transactionHash}`);
  return r;
}

// ===== Main handler =====
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");
    const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    const bal=await getChainBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance ${BALANCE_ADDRESS}: ${bal} ETH`);

    const orders=await fetchOrdersFromIF();
    if(!orders.length){await log("ℹ️ Žiadne čakajúce objednávky");return res.json({ok:true,balance_eth:bal,funded_count:0});}

    let funded=0;
    for(const o of orders){
      const addr=o.user_address,tid=Number(o.token_id);
      if(!addr||!tid) continue;
      const eur=Number(o.amount??o.amount_eur??0);
      const eth=eur>0?eur/rate:0.0001;
      const r=await sendEthToNFT({user_addr:addr,token_id:tid,ethAmount:eth,gasPrice:gas});
      funded++;await markOrderPaid(o.paymentIntentId||tid,r.transactionHash,addr);
    }
    await log(`✅ FUND DONE funded=${funded}`);
    res.json({ok:true,balance_eth:bal,funded_count:funded});
  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}