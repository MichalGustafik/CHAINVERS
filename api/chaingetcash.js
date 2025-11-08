import Web3 from 'web3';
import fetch from 'node-fetch';
import fs from 'fs';

const web3 = new Web3(process.env.PROVIDER_URL);
const FROM = process.env.FROM_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;
const CHAINVERS_KEY = process.env.CHAINVERS_KEY || '';
const MINT_THRESHOLD = Number(process.env.MINT_THRESHOLD ?? '0.05');
const MINT_MIN_ETH = Number(process.env.MINT_MIN_ETH ?? '0.0001');
const PARALLEL_LIMIT = Number(process.env.MINT_PARALLEL ?? '1');
const ABI = [{type:'function',name:'fundTokenFor',inputs:[{type:'address',name:'user'},{type:'uint256',name:'tokenId'}]}];

async function sendLog(m){if(!INF_FREE_URL)return;
  try{await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:`[${new Date().toISOString()}] ${m}`})});}
  catch(e){console.error('log fail',e.message);}}
const log=async(...a)=>{const s=a.join(' ');console.log(s);await sendLog(s);};

async function getEurEthRate(){try{const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
  const j=await r.json();const rate=j?.ethereum?.eur;if(!rate)throw 0;await log(`💱 1 ETH = ${rate} EUR`);return rate;}
  catch{await log('⚠️ CoinGecko fail, fallback 2500 EUR');return 2500;}}

async function getGasPrice(){const g=await web3.eth.getGasPrice();await log(`⛽ Gas: ${web3.utils.fromWei(g,'gwei')} GWEI`);return g;}
async function getBalances(){try{const w=await web3.eth.getBalance(FROM);const c=await web3.eth.getBalance(CONTRACT);
  const we=Number(web3.utils.fromWei(w,'ether')),ce=Number(web3.utils.fromWei(c,'ether'));
  await log(`💼 Wallet(${FROM}): ${we}`);await log(`🏦 Contract(${CONTRACT}): ${ce}`);return{fromEth:we,contractEth:ce};}
  catch(e){await log('⚠️ getBalances err',e.message);return{fromEth:0,contractEth:0};}}

async function fetchOrders(){const r=await fetch(`${INF_FREE_URL}/accptpay.php`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'refresh'})});
  const j=await r.json();return Array.isArray(j)?j.filter(o=>o.token_id&&o.status!=='💰 Zaplatené'):[];}

async function markOrder(order_id,tx,user){const h={'Content-Type':'application/x-www-form-urlencoded'};if(CHAINVERS_KEY)h['X-CHAINVERS-KEY']=CHAINVERS_KEY;
  await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{method:'POST',headers:h,body:new URLSearchParams({order_id,tx_hash:tx,user_addr:user})});}

async function sendEth({user,token,ethAmount,gasPrice}){const c=new web3.eth.Contract(ABI,CONTRACT);
  const val=web3.utils.toWei(String(ethAmount),'ether');
  const gas=await c.methods.fundTokenFor(user,token).estimateGas({from:FROM,value:val});
  const tx={from:FROM,to:CONTRACT,value:val,data:c.methods.fundTokenFor(user,token).encodeABI(),
    gas:web3.utils.toHex(gas),gasPrice:web3.utils.toHex(gasPrice),nonce:await web3.eth.getTransactionCount(FROM,'pending'),chainId:await web3.eth.getChainId()};
  await log(`▶️ fundTokenFor(${user},${token}) ${ethAmount} ETH`);
  const signed=await web3.eth.accounts.signTransaction(tx,PRIVATE_KEY);
  const r=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  try{fs.appendFileSync('/tmp/fundtx.log',`${Date.now()} ${r.transactionHash}\n`);}catch{}await log(`✅ TX ${r.transactionHash}`);return r;}

export default async function handler(req,res){try{
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
  const key=req.headers['x-chainvers-key']||'';if(CHAINVERS_KEY&&key!==CHAINVERS_KEY)return res.status(403).json({ok:false,error:'unauth'});
  await log('===== CHAINGETCASH START =====');
  const [eur,gp]={0:await getEurEthRate(),1:await getGasPrice()};
  const {fromEth,contractEth}=await getBalances();
  const orders=await fetchOrders();if(!orders.length){await log('ℹ️ No pending');return res.status(200).json({ok:true,wallet_eth:fromEth,balance_eth:contractEth,funded_count:0});}
  let funded = 0;

  // FIFO: created_at ↑, potom amount ↑, potom token_id ↑
  orders.sort((a, b) => {
    const da = new Date(a.created_at || 0) - new Date(b.created_at || 0);
    if (da !== 0) return da;
    const pa = (+a.amount || 0) - (+b.amount || 0);
    if (pa !== 0) return pa;
    return (+a.token_id || 0) - (+b.token_id || 0);
  });

  // Pozn.: ETH posielame Z PENEŽENKY (FROM). Kontraktový zostatok len reportujeme.
  // Rozpočet (= koľko vieme ešte poslať) teda sledujeme podľa fromEth.
  let remainingFrom = fromEth;

  // Batch spracovanie (PARALLEL_LIMIT)
  const batches = [];
  for (let i = 0; i < orders.length; i += PARALLEL_LIMIT) {
    batches.push(orders.slice(i, i + PARALLEL_LIMIT));
  }

  for (const batch of batches) {
    await Promise.all(batch.map(async (o) => {
      try {
        const order_id   = o.paymentIntentId || o.id || `${o.user_address}_${o.token_id}`;
        const user_addr  = o.user_address;
        const token_id   = Number(o.token_id);
        const amount_eur = Number(o.amount ?? o.amount_eur ?? 0);

        if (!user_addr || !web3.utils.isAddress(user_addr) || !token_id) {
          await log(`⚠️ Preskakujem ${order_id}: neplatné user/token`);
          return;
        }

        // Výpočet dávky ETH:
        // - ak má peňaženka aspoň "prahový" zostatok (MINT_THRESHOLD), použijeme prepočet €→ETH
        // - inak pošleme minimálnu dávku (MINT_MIN_ETH)
        let ethAmount = MINT_MIN_ETH;
        if (remainingFrom >= MINT_THRESHOLD && amount_eur > 0) {
          ethAmount = amount_eur / eur;
        }

        // Overenie, že máme na peňaženke aj value+gas
        const gasPrice = await getGasPrice();
        const contract = new web3.eth.Contract(ABI, CONTRACT);
        const valueWei = web3.utils.toWei(String(ethAmount), 'ether');
        const gasLimit = await contract.methods
          .fundTokenFor(user_addr, token_id)
          .estimateGas({ from: FROM, value: valueWei });

        const gasCostEth = Number(web3.utils.fromWei(
          web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit)),
          'ether'
        ));
        const needEth = ethAmount + gasCostEth;

        if (remainingFrom < needEth) {
          await log(`⚠️ Nedostatok ETH na peňaženke pre ${order_id}: treba ~${needEth.toFixed(6)} ETH, máme ${remainingFrom.toFixed(6)} ETH`);
          return;
        }

        // Odošli TX
        const receipt = await sendEth({
          user: user_addr,
          token: token_id,
          ethAmount,
          gasPrice
        });

        funded += 1;
        remainingFrom -= needEth;

        // Označ objednávku ako zaplatenú
        await markOrder(order_id, receipt.transactionHash, user_addr);
      } catch (e) {
        await log(`❌ Batch TX chyba: ${e.message}`);
      }
    }));
  }

  await log(`✅ FUND DONE · funded=${funded} · wallet_start=${fromEth} · wallet_est_end≈${remainingFrom}`);
  // Re-odčítanie kontraktového zostatku po kole (voliteľne)
  const contractEndWei = await web3.eth.getBalance(CONTRACT);
  const contractEndEth = Number(web3.utils.fromWei(contractEndWei, 'ether'));

  return res.status(200).json({
    ok: true,
    wallet_eth: remainingFrom,   // odhad po kole
    balance_eth: contractEndEth, // skutočný kontraktový zostatok po kole
    funded_count: funded
  });

} catch (err) {
  await log('❌ ERROR:', err.message);
  return res.status(500).json({ ok:false, error: err.message });
}
}