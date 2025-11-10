import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PRIMARY_RPC   = process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/YOUR_KEY";
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

/* === RPC AUTO-SELECTION === */
async function initWeb3() {
  const rpcCandidates = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcCandidates) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✅ Using RPC: ${rpc}`);
      return w3;
    } catch (e) {
      console.log(`⚠️ RPC failed ${rpc}: ${e.message}`);
    }
  }
  throw new Error("No available RPC nodes");
}
const web3 = await initWeb3();

/* === ABI === */
const ABI = [
  { type: "function", name: "mintCopy", inputs: [{ type: "uint256", name: "originalId" }] },
  { type: "function", name: "mintFee", inputs: [], outputs: [{ type: "uint256", name: "" }], stateMutability: "view" }
];

/* === LOGGING === */
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

/* === HELPERS === */
async function getEurEthRate(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j=await r.json();const rate=j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate||2500;
  }catch{await log("⚠️ CoinGecko fail → 2500");return 2500;}
}
async function getGasPrice(){
  try{const gp=await web3.eth.getGasPrice();await log(`⛽ Gas: ${web3.utils.fromWei(gp,"gwei")} GWEI`);return gp;}
  catch(e){await log(`⚠️ GasPrice error: ${e.message}`);return web3.utils.toWei("1","gwei");}
}
async function getBalanceEth(addr){
  try{const w=await web3.eth.getBalance(addr);return Number(web3.utils.fromWei(w,"ether"));}
  catch(e){await log(`⚠️ getBalance fail: ${e.message}`);return 0;}
}
async function getMintFee(contract){
  try{
    const feeWei=await contract.methods.mintFee().call();
    const feeEth=Number(web3.utils.fromWei(feeWei,"ether"));
    await log(`💰 Contract mintFee = ${feeEth} ETH`);
    return feeEth;
  }catch(e){await log(`⚠️ mintFee() read fail: ${e.message}`);return 0.0001;}
}

/* === Fallback update_order === */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  try {
    const params = new URLSearchParams({ order_id, tx_hash, user_addr });
    const resp = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (!resp.ok) {
      await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order&` + params.toString());
      await log(`🟡 Fallback GET update_order ${order_id}`);
    } else await log(`📝 update_order ${order_id}`);
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
    try {
      const params = new URLSearchParams({ order_id, tx_hash, user_addr });
      await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order&` + params.toString());
      await log(`🟡 Second fallback GET update_order ${order_id}`);
    } catch {}
  }
}

/* === TX === */
async function mintCopyTx({ token_id, ethAmount, gasPrice, mintFeeEth }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueEth = ethAmount > 0 ? ethAmount : mintFeeEth || 0.0001;
  const valueWei = web3.utils.toWei(String(valueEth), "ether");

  const gasLimit = await contract.methods.mintCopy(token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM, to: CONTRACT, value: valueWei,
    data: contract.methods.mintCopy(token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* === MAIN HANDLER === */
export default async function handler(req,res){
  try{
    if(req.method!=="POST")return res.status(405).json({ok:false,error:"POST only"});
    await log("===== CHAINGETCASH START =====");

    const balEth=(await getBalanceEth(FROM)).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`);

    const orders=req.body?.orders||[];
    if(!orders.length){await log("ℹ️ Žiadne objednávky v tele – len balance update");
      return res.json({ok:true,balance_eth:balEth,funded_count:0});}

    // ✅ Odpoveď okamžite (anti-timeout)
    res.status(200).json({ok:true,message:"Mintovanie prebieha na pozadí…"});

    // 🔄 Pozadie (mint pokračuje)
    setTimeout(async()=>{
      const [rate,gas]=await Promise.all([getEurEthRate(),getGasPrice()]);
      const contract=new web3.eth.Contract(ABI,CONTRACT);
      const mintFeeEth=await getMintFee(contract);

      let totalEur=0;orders.forEach(o=>totalEur+=Number(o.amount_eur??o.amount??0));
      const ethPerEur=1/rate;
      const gasPriceEth=Number(web3.utils.fromWei(gas,"ether"));
      const gasCostPerTx=gasPriceEth*250000;
      const totalGasEth=gasCostPerTx*orders.length;
      const totalGasEur=totalGasEth/ethPerEur;
      const mintFeeTotalEth=mintFeeEth*orders.length;
      const mintFeeTotalEur=mintFeeTotalEth/ethPerEur;
      await log(`📊 Náklady: Objednávky=${totalEur.toFixed(2)}€ | Gas≈${totalGasEth.toFixed(6)} ETH (${totalGasEur.toFixed(2)} €) | MintFee≈${mintFeeTotalEth.toFixed(6)} ETH (${mintFeeTotalEur.toFixed(2)} €)`);

      let funded=0;
      for(const o of orders){
        const token_id=Number(o.token_id);
        if(!token_id){await log(`⚠️ Neplatný token_id: ${JSON.stringify(o)}`);continue;}
        const eur=Number(o.amount_eur??o.amount??0);
        const eth=eur>0?(eur/rate):(mintFeeEth>0?mintFeeEth:0.0001);

        try{
          const txHash=await mintCopyTx({token_id,ethAmount:eth,gasPrice:gas,mintFeeEth});
          funded++;await markOrderPaid(o.paymentIntentId||String(token_id),txHash,o.user_address);
        }catch(err){await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);}
      }
      await log(`✅ MINT DONE funded=${funded}`);
    },100);

  }catch(e){
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ok:false,error:e.message});
  }
}