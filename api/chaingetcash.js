import Web3 from "web3";
import fetch from "node-fetch";

/* === ENVIRONMENT === */
const PROVIDER_URL  = process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/e366c7dc19724672add84aeec6b35203";
const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS || "0x6907baCC70369072d9a1ff630787Cb46667bc33C";
const CONTRACT      = process.env.CONTRACT_ADDRESS || "0x4Cc1311D16F2FC91630ffa4b9387b4E2FF375E1D";
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

const web3 = new Web3(PROVIDER_URL);
await web3.eth.getBlockNumber(); // test connection

const ABI = [
  { type:"function", name:"mintCopy", inputs:[{type:"uint256", name:"originalId"}] },
  { type:"function", name:"mintFee",  inputs:[], outputs:[{type:"uint256", name:""}], stateMutability:"view" }
];

/* === LOGGING === */
async function sendLog(message){
  try{
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({message:`[${new Date().toISOString()}] ${message}`})
    });
  }catch{}
}
const log = async (...a)=>{const m=a.join(" ");console.log(m);await sendLog(m);};

/* === HELPERS === */
async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();const rate=j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);return rate||2500;
  }catch{await log("⚠️ CoinGecko fail → 2500");return 2500;}
}
async function getGasPrice(){
  try{
    const gp=await web3.eth.getGasPrice();
    await log(`⛽ Gas: ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;
  }catch(e){await log(`⚠️ GasPrice error: ${e.message}`);return web3.utils.toWei("1","gwei");}
}
async function getBalanceEth(addr){
  const w=await web3.eth.getBalance(addr);
  return Number(web3.utils.fromWei(w,"ether"));
}
async function getMintFee(contract){
  try{
    const f=await contract.methods.mintFee().call();
    const eth=Number(web3.utils.fromWei(f,"ether"));
    await log(`💰 Contract mintFee = ${eth} ETH`);return eth;
  }catch(e){await log(`⚠️ mintFee() error: ${e.message}`);return 0.001;}
}
async function markOrderPaid(order_id,tx_hash,user_addr){
  await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({order_id,tx_hash,user_addr})
  });
  await log(`📝 update_order ${order_id}`);
}

/* === MINT === */
const MIN_FALLBACK_ETH = 0.00005;
async function mintCopyTx({ token_id, eurAmount, rate, gasPrice, mintFeeEth }){
  const contract=new web3.eth.Contract(ABI,CONTRACT);
  let valueEth=(eurAmount>0)?(eurAmount/rate):(mintFeeEth>0?mintFeeEth:MIN_FALLBACK_ETH);
  const valueWei=web3.utils.toWei(String(valueEth),"ether");

  await log(`🪙 From: ${FROM}`);
  await log(`➡️ To Contract: ${CONTRACT}`);
  await log(`→ Token ${token_id} (${eurAmount}€ ≈ ${valueEth} ETH)`);

  const gasLimit=await contract.methods.mintCopy(token_id).estimateGas({from:FROM,value:valueWei});
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

/* === MAIN HANDLER === */
export const config={api:{bodyParser:true}};
export default async function handler(req,res){
  try{
    if(req.method!=="POST")return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");
    await log(`💳 FROM: ${FROM}`);
    await log(`🏦 CONTRACT: ${CONTRACT}`);

    const balEth=(await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`).catch(()=>{});

    const orders=req.body?.orders||[];
    if(!orders.length){await log("ℹ️ Žiadne objednávky");return res.json({ok:true,balance_eth:balEth});}

    const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
    const contract=new web3.eth.Contract(ABI,CONTRACT);
    const mintFeeEth=await getMintFee(contract);

    let funded=0,totalEur=0;
    for(const o of orders){
      const token_id=Number(o.token_id);
      const eur=Number(o.amount_eur??o.amount??0);
      totalEur+=eur;
      try{
        const tx=await mintCopyTx({token_id,eurAmount:eur,rate,gasPrice:gas,mintFeeEth});
        if(tx){funded++;await markOrderPaid(o.paymentIntentId||String(token_id),tx,o.user_address);}
      }catch(e){await log(`⚠️ MintCopy ${token_id} failed: ${e.message}`);}
    }

    await log(`📊 Náklady: ${totalEur.toFixed(2)}€`);
    await log(`✅ MINT DONE funded=${funded}`);
    res.json({ok:true,balance_eth:balEth,funded_count:funded});
  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}