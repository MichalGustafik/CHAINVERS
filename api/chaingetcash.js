import Web3 from "web3";
import fetch from "node-fetch";

const INFURA_RPC = process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/YOUR_KEY";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FROM = process.env.FROM_ADDRESS;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

const web3 = new Web3(INFURA_RPC);
const ABI = [
  { type: "function", name: "mintCopy", inputs: [{ type: "uint256", name: "originalId" }] },
  { type: "function", name: "mintFee", inputs: [], outputs: [{ type: "uint256", name: "" }], stateMutability: "view" }
];

export const config = { api: { bodyParser: true } };

async function sendLog(msg){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${msg}`})
    });
  }catch{}
}
const log = async(...a)=>{const m=a.join(" ");console.log(m);await sendLog(m);};

async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();const rate=j?.ethereum?.eur;
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

async function getMintFee(contract){
  try{
    const f=await contract.methods.mintFee().call();
    const e=Number(web3.utils.fromWei(f,"ether"));
    await log(`💰 Contract mintFee=${e} ETH`);
    return e;
  }catch(e){await log("⚠️ mintFee() fail");return 0.0001;}
}

async function markOrderPaid(order_id,tx_hash,user_addr){
  const params=new URLSearchParams({order_id,tx_hash,user_addr});
  try{
    const r=await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:params
    });
    if(!r.ok){
      await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order&`+params.toString());
      await log(`🟡 Fallback GET update_order ${order_id}`);
    }else await log(`📝 update_order ${order_id}`);
  }catch(e){
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

async function mintCopyTx({token_id,ethAmount,gasPrice,mintFeeEth}){
  const c=new web3.eth.Contract(ABI,CONTRACT);
  const valueEth=ethAmount>0?ethAmount:mintFeeEth||0.0001;
  const valueWei=web3.utils.toWei(String(valueEth),"ether");
  const gasLimit=await c.methods.mintCopy(token_id).estimateGas({from:FROM,value:valueWei});
  const tx={
    from:FROM,to:CONTRACT,value:valueWei,
    data:c.methods.mintCopy(token_id).encodeABI(),
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

export default async function handler(req,res){
  try{
    if(req.method!=="POST")return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");

    const balEth=(await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`);

    const orders=req.body?.orders||[];
    if(!orders.length){await log("ℹ️ Žiadne objednávky");return res.json({ok:true});}
    res.status(200).json({ok:true,message:"Mintovanie beží na pozadí…"});

    setTimeout(async()=>{
      const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
      const contract=new web3.eth.Contract(ABI,CONTRACT);
      const mintFeeEth=await getMintFee(contract);
      const chunkSize=3;
      const chunks=[];
      for(let i=0;i<orders.length;i+=chunkSize)chunks.push(orders.slice(i,i+chunkSize));

      for(const group of chunks){
        await log(`🚀 Spracúvam ${group.length} objednávky`);
        for(const o of group){
          const token_id=Number(o.token_id);
          if(!token_id)continue;
          const eur=Number(o.amount_eur??o.amount??0);
          let eth=eur>0?eur/rate:mintFeeEth;
          if(eth<0.0001)eth=0.0001;
          await log(`💶 ${eur.toFixed(2)} € => ${eth.toFixed(6)} ETH`);
          try{
            const txHash=await mintCopyTx({token_id,ethAmount:eth,gasPrice:gas,mintFeeEth});
            await markOrderPaid(o.paymentIntentId||String(token_id),txHash,o.user_address);
          }catch(err){await log(`⚠️ Mint ${token_id} failed: ${err.message}`);}
        }
        await new Promise(r=>setTimeout(r,1500)); // pauza medzi dávkami
      }
      await log("✅ MINT DONE – všetky dávky hotové");
    },100);

  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}