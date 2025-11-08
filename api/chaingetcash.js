import Web3 from "web3";
import fetch from "node-fetch";
const PROVIDER_URL=process.env.PROVIDER_URL;
const PRIVATE_KEY=process.env.PRIVATE_KEY;
const FROM=process.env.FROM_ADDRESS;
const CONTRACT=process.env.CONTRACT_ADDRESS;
const INF_FREE_URL=(process.env.INF_FREE_URL||"https://chainvers.free.nf").replace(/\/$/,"");
const BALANCE_ADDRESS=process.env.BALANCE_ADDRESS||FROM;

const web3=new Web3(PROVIDER_URL);
const ABI=[{type:"function",name:"fundTokenFor",inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]}];
export const config={api:{bodyParser:true}};

async function sendLog(m){try{await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({message:`[${new Date().toISOString()}] ${m}`})});}catch{}}
const log=async(...a)=>{const m=a.join(" ");console.log(m);await sendLog(m);};

async function getRate(){try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");const j=await r.json();return j?.ethereum?.eur||2500;}catch{return 2500;}}
async function getGas(){const gp=await web3.eth.getGasPrice();await log(`⛽ Gas: ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;}
async function getBal(a){const w=await web3.eth.getBalance(a);const e=Number(web3.utils.fromWei(w,"ether"));await log(`💠 Balance ${a}: ${e} ETH`);return e;}

async function fetchOrders(){
 try{
   const r=await fetch(`${INF_FREE_URL}/accptpay.php?action=refresh_safe`);
   const html=await r.text();const m=html.match(/<pre>([\s\S]*?)<\/pre>/);
   if(!m)throw new Error("no JSON");const arr=JSON.parse(m[1]);
   return arr.filter(o=>o.token_id && o.status!=="💰 Zaplatené");
 }catch(e){await log(`⚠️ fetchOrders: ${e.message}`);return[];}
}

async function markPaid(id,tx,u){try{await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({order_id:id,tx_hash:tx,user_addr:u})});await log(`📝 update_order ${id}`);}catch(e){await log(`⚠️ update_order err: ${e.message}`);}}

async function sendEth({u,t,eth,gas}){
 const c=new web3.eth.Contract(ABI,CONTRACT);
 const v=web3.utils.toWei(String(eth),"ether");
 const gL=await c.methods.fundTokenFor(u,t).estimateGas({from:FROM,value:v});
 const tx={from:FROM,to:CONTRACT,value:v,data:c.methods.fundTokenFor(u,t).encodeABI(),gas:web3.utils.toHex(gL),gasPrice:web3.utils.toHex(gas),nonce:await web3.eth.getTransactionCount(FROM,"pending"),chainId:await web3.eth.getChainId()};
 await log(`▶️ TX fundTokenFor(${u},${t}) ${eth} ETH`);
 const s=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
 const r=await web3.eth.sendSignedTransaction(s.rawTransaction);
 await log(`✅ TX ${r.transactionHash}`);return r;
}

export default async function handler(req,res){
 try{
   if(req.method!=="POST")return res.status(405).json({ok:false});
   await log("===== CHAINGETCASH START =====");
   const [rate,gas,bal]=await Promise.all([getRate(),getGas(),getBal(BALANCE_ADDRESS)]);
   await sendLog(`💱 1 ETH = ${rate} EUR`);
   await sendLog(`💠 Balance sent to accptpay (${bal} ETH)`);

   const orders=await fetchOrders();
   if(!orders.length){await log("ℹ️ Žiadne čakajúce objednávky");return res.json({ok:true,balance_eth:bal,funded_count:0});}

   let funded=0;
   for(const o of orders){
     const addr=o.user_address,tid=Number(o.token_id);
     if(!addr||!tid)continue;
     const eur=Number(o.amount??o.amount_eur??0);
     const eth=eur>0?eur/rate:0.0001;
     const r=await sendEth({u:addr,t:tid,eth,gas});
     funded++;await markPaid(o.paymentIntentId||tid,r.transactionHash,addr);
   }
   await log(`✅ FUND DONE funded=${funded}`);
   res.json({ok:true,balance_eth:bal,funded_count:funded});
 }catch(e){await log(`❌ ERROR: ${e.message}`);res.status(500).json({ok:false,error:e.message});}
}