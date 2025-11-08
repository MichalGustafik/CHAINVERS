import Web3 from "web3";
import fetch from "node-fetch";

const INF_FREE_URL=(process.env.INF_FREE_URL||"https://chainvers.free.nf").replace(/\/$/,"");
const PROVIDER_URL=process.env.PROVIDER_URL;
const PRIVATE_KEY=process.env.PRIVATE_KEY;
const FROM=process.env.FROM_ADDRESS;
const CONTRACT=process.env.CONTRACT_ADDRESS;
const web3=new Web3(PROVIDER_URL);
const ABI=[{type:"function",name:"fundTokenFor",inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]}];

export const config={api:{bodyParser:true}};
async function log(msg){console.log(msg);
await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log&message=${encodeURIComponent(msg)}`).catch(()=>{});}

/* ETH rate */ async function rate(){try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");const j=await r.json();await log(`💱 1 ETH=${j.ethereum.eur} EUR`);return j.ethereum.eur;}catch{return 2500;}}
/* gas */ async function gasP(){const g=await web3.eth.getGasPrice();await log(`⛽ Gas=${web3.utils.fromWei(g,"gwei")} GWEI`);return g;}
/* balance */ async function bal(a){return Number(web3.utils.fromWei(await web3.eth.getBalance(a),"ether"));}
/* get orders */ async function getO(){const r=await fetch(`${INF_FREE_URL}/accptpay.php?action=refresh_safe&cb=${Date.now()}`);const h=await r.text();
const m=h.match(/<pre>([\s\S]*?)<\/pre>/);if(!m)throw new Error("no JSON");const a=JSON.parse(m[1]);
return a.filter(o=>o.token_id&&o.status!=="💰 Zaplatené");}
/* update */ async function upd(id,tx,u){await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order&order_id=${encodeURIComponent(id)}&tx_hash=${encodeURIComponent(tx)}&user_addr=${encodeURIComponent(u)}`).catch(()=>{});}
/* TX */ async function fund({user_addr,token_id,ethAmount,gasPrice}){const c=new web3.eth.Contract(ABI,CONTRACT);
const val=web3.utils.toWei(String(ethAmount),"ether");
const lim=await c.methods.fundTokenFor(user_addr,token_id).estimateGas({from:FROM,value:val});
const tx={from:FROM,to:CONTRACT,value:val,data:c.methods.fundTokenFor(user_addr,token_id).encodeABI(),
gas:web3.utils.toHex(lim),gasPrice:web3.utils.toHex(gasPrice),nonce:await web3.eth.getTransactionCount(FROM,"pending"),chainId:await web3.eth.getChainId()};
const s=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
const r=await web3.eth.sendSignedTransaction(s.rawTransaction);
await log(`✅ TX:${r.transactionHash}`);return r;}

export default async function handler(req,res){
try{
if(req.method!=="POST")return res.status(405).json({ok:false});
await log("===== CHAINGETCASH START =====");
const [g,e]=await Promise.all([gasP(),rate()]);
const b=await bal(FROM);await log(`💠 Balance:${b} ETH`);
const os=await getO();await log(`📦 ${os.length} orders`);
let funded=0;for(const o of os){const eth=(Number(o.amount||o.amount_eur||0)||1)/e;
const r=await fund({user_addr:o.user_address,token_id:o.token_id,ethAmount:eth,gasPrice:g});
await upd(o.paymentIntentId||o.id||o.token_id,r.transactionHash,o.user_address);funded++;}
await log(`✅ DONE funded=${funded}`);
res.json({ok:true,balance_eth:b,funded_count:funded});
}catch(e){await log("❌ ERROR:"+e.message);res.status(500).json({ok:false,error:e.message});}}