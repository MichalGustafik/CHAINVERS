import Web3 from "web3";
import fetch from "node-fetch";

const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

const web3 = new Web3(PROVIDER_URL);
const ABI = [{
  type:"function", name:"fundTokenFor",
  inputs:[{type:"address",name:"user"},{type:"uint256",name:"tokenId"}]
}];

export const config = { api: { bodyParser: true } };

// LOG to InfinityFree
async function sendLog(msg){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "ChainversBot/1.0"
      },
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${msg}`})
    });
  }catch{}
}
const log = async (...a)=>{ const m=a.join(" "); console.log(m); await sendLog(m); };

// HELPERS
async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json(); const rate=j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate||2500;
  }catch{ await log("⚠️ CoinGecko fail → 2500"); return 2500; }
}
async function getGasPrice(){
  const gp=await web3.eth.getGasPrice();
  await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp,"gwei")} GWEI`);
  return gp;
}
async function getBalanceEth(addr){
  const w=await web3.eth.getBalance(addr);
  return Number(web3.utils.fromWei(w,"ether"));
}

// UPDATE ORDER back to IF
async function markOrderPaid(order_id, tx_hash, user_addr){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "ChainversBot/1.0"
      },
      body:new URLSearchParams({order_id,tx_hash,user_addr})
    });
    await log(`📝 update_order ${order_id}`);
  }catch(e){ await log(`⚠️ update_order failed: ${e.message}`); }
}

// TX – fundTokenFor
async function fundToken({ user_address, token_id, ethAmount, gasPrice }){
  const contract=new web3.eth.Contract(ABI,CONTRACT);
  const valueWei=web3.utils.toWei(String(ethAmount),"ether");
  const gasLimit=await contract.methods
    .fundTokenFor(user_address,token_id)
    .estimateGas({from:FROM,value:valueWei});

  const tx={
    from:FROM,to:CONTRACT,value:valueWei,
    data:contract.methods.fundTokenFor(user_address,token_id).encodeABI(),
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

// MAIN HANDLER
export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");

    const balEth=(await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`,{
      method:"GET",
      headers:{ "Referer": INF_FREE_URL + "/", "User-Agent": "ChainversBot/1.0" }
    });

    const orders=req.body?.orders||[];
    if(!orders.length){
      await log("ℹ️ Žiadne objednávky v tele – iba balance update");
      return res.json({ok:true,balance_eth:balEth,funded_count:0});
    }

    const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    let funded=0;
    for(const o of orders){
      const addr=o.user_address;
      const tid=Number(o.token_id);
      if(!addr||!web3.utils.isAddress(addr)||!tid){ await log("⚠️ Neplatná objednávka, skip"); continue; }
      const eur=Number(o.amount_eur??o.amount??0);
      const eth=eur>0?(eur/rate):0.0001;
      const tx=await fundToken({user_address:addr,token_id:tid,ethAmount:eth,gasPrice:gas});
      funded++; await markOrderPaid(o.paymentIntentId||String(tid),tx,addr);
    }

    await log(`✅ FUND DONE funded=${funded}`);
    res.json({ok:true,balance_eth:balEth,funded_count:funded});
  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}