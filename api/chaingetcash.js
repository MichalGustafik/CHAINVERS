import Web3 from "web3";
import fetch from "node-fetch";

const RPCS = [
  process.env.PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://rpc.ankr.com/base"
];
let web3 = null;
for (const url of RPCS) {
  try {
    const w = new Web3(url);
    await w.eth.getBlockNumber();
    web3 = w;
    console.log(`✅ Using RPC: ${url}`);
    break;
  } catch (e) {
    console.log(`⚠️ RPC fail: ${url} (${e.message})`);
  }
}
if (!web3) throw new Error("No working RPC node");

const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

const ABI = [{
  type:"function",
  name:"mintCopy",
  inputs:[{type:"uint256",name:"originalId"}]
}];

export const config = { api: { bodyParser:true } };

// ---- logovanie ----
async function sendLog(msg){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${msg}`})
    });
  }catch{}
}
const log = async (...a)=>{const m=a.join(" ");console.log(m);await sendLog(m);};

// ---- helpery ----
async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();
    const rate=j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate||2500;
  }catch{await log("⚠️ CoinGecko fail → 2500");return 2500;}
}
async function getGasPrice(){
  const gp=await web3.eth.getGasPrice();
  await log(`⛽ Gas: ${web3.utils.fromWei(gp,"gwei")} GWEI`);
  return gp;
}
async function getBalanceEth(addr){
  const w=await web3.eth.getBalance(addr);
  return Number(web3.utils.fromWei(w,"ether"));
}

// ---- označenie objednávky ako zaplatenej ----
async function markOrderPaid(order_id, tx_hash, user_addr){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({order_id,tx_hash,user_addr})
    });
    await log(`📝 update_order ${order_id}`);
  }catch(e){await log(`⚠️ update_order fail: ${e.message}`);}
}

// ---- mintCopy transakcia ----
async function mintCopyTx({ token_id, ethAmount, gasPrice }){
  const contract=new web3.eth.Contract(ABI,CONTRACT);
  const valueWei=web3.utils.toWei(String(ethAmount),"ether");
  const gasLimit=await contract.methods.mintCopy(token_id)
    .estimateGas({from:FROM,value:valueWei});
  const tx={
    from:FROM,to:CONTRACT,value:valueWei,
    data:contract.methods.mintCopy(token_id).encodeABI(),
    gas:web3.utils.toHex(gasLimit),
    gasPrice:web3.utils.toHex(gasPrice),
    nonce:await web3.eth.getTransactionCount(FROM,"pending"),
    chainId:await web3.eth.getChainId()
  };
  const signed=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
  const receipt=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

// ---- hlavný handler ----
export default async function handler(req,res){
  try{
    if(req.method!=="POST")return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");

    const balEth=(await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`);

    const orders=req.body?.orders||[];
    if(!orders.length){
      await log("ℹ️ Žiadne objednávky v tele");
      return res.json({ok:true,balance_eth:balEth,funded_count:0});
    }

    const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    let funded=0;
    for(const o of orders){
      const token_id=Number(o.token_id);
      if(!token_id){await log(`⚠️ Neplatný token_id ${JSON.stringify(o)}`);continue;}
      const eur=Number(o.amount_eur??o.amount??0);
      const eth=eur>0?(eur/rate):0.001;
      try{
        const tx=await mintCopyTx({token_id,ethAmount:eth,gasPrice:gas});
        funded++;await markOrderPaid(o.paymentIntentId||String(token_id),tx,o.user_address);
      }catch(err){await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);}
    }

    await log(`✅ MINT DONE funded=${funded}`);
    res.json({ok:true,balance_eth:balEth,funded_count:funded});
  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}