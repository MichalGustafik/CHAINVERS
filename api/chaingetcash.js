import Web3 from 'web3';
import fetch from 'node-fetch';
import fs from 'fs';

// ===== ENV =====
const PROVIDER_URL   = process.env.PROVIDER_URL;
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FROM           = process.env.FROM_ADDRESS;
const CONTRACT       = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY = process.env.INFURA_API_KEY || '';
const INF_FREE_URL   = process.env.INF_FREE_URL;           // https://<tvoje>.free.nf
const CHAINVERS_KEY  = process.env.CHAINVERS_KEY || '';

const MINT_THRESHOLD = Number(process.env.MINT_THRESHOLD ?? '0.05');   // ak je zostatok >=, dobíjame podľa € sumy
const MINT_MIN_ETH   = Number(process.env.MINT_MIN_ETH  ?? '0.0001');  // inak minimálna suma
const BALANCE_ADDRESS= process.env.BALANCE_ADDRESS || FROM;
const PARALLEL_LIMIT = Number(process.env.MINT_PARALLEL ?? '1');       // odporúčané 1

const web3 = new Web3(PROVIDER_URL);
const ABI = [{ type:'function', name:'fundTokenFor', inputs:[ {type:'address', name:'user'}, {type:'uint256', name:'tokenId'} ] }];

export const config = { api: { bodyParser: true } };

// ---------- logging ----------
async function sendLog(message) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${message}` })
    });
  } catch (e) { console.error('log fail', e.message); }
}
const log = async (...a) => { const line = a.join(' '); console.log(line); await sendLog(line); };

// ---------- helpers ----------
async function getEurEthRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
    const j = await r.json(); const rate = j?.ethereum?.eur;
    if (!rate) throw new Error('rate missing');
    await log(`💱 1 ETH = ${rate} EUR`); return rate;
  } catch { await log('⚠️ CoinGecko fail, fallback 2500 EUR'); return 2500; }
}
async function getGasPrice() {
  try {
    if (INFURA_API_KEY) {
      const r=await fetch(`https://gas.api.infura.io/v3/${INFURA_API_KEY}`); const j=await r.json();
      const gwei=j?.data?.fast?.maxFeePerGas ?? null;
      if (gwei) { const wei=web3.utils.toWei(String(Math.round(Number(gwei))),'gwei'); await log(`⛽ Gas (Infura): ${gwei} GWEI`); return wei; }
    }
  } catch(e){ await log('⚠️ Infura gas fallback:', e.message); }
  const gp = await web3.eth.getGasPrice(); await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp,'gwei')} GWEI`); return gp;
}
async function getChainBalanceEth(address) { const wei=await web3.eth.getBalance(address); return Number(web3.utils.fromWei(wei,'ether')); }

async function fetchOrdersFromIF() {
  // zavoláme priamo accptpay.php → action=refresh
  const resp = await fetch(`${INF_FREE_URL}/accptpay.php`, {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({action:'refresh'})
  });
  if(!resp.ok) throw new Error(`IF refresh failed: ${resp.status}`);
  const list = await resp.json(); if(!Array.isArray(list)) throw new Error('orders invalid');
  const pending = list.filter(o => (o.status!=='💰 Zaplatené') && o.token_id);
  // FIFO + cena + token_id
  pending.sort((a,b)=>{
    const da=(new Date(a.created_at||0))-(new Date(b.created_at||0)); if(da!==0) return da;
    const pa=(+a.amount||0)-(+b.amount||0); if(pa!==0) return pa;
    return (+a.token_id||0)-(+b.token_id||0);
  });
  return pending;
}

async function markOrderPaid(order_id, tx_hash, user_addr) {
  const headers={'Content-Type':'application/x-www-form-urlencoded'}; if(CHAINVERS_KEY) headers['X-CHAINVERS-KEY']=CHAINVERS_KEY;
  const resp=await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`,{method:'POST',headers,body:new URLSearchParams({order_id,tx_hash,user_addr})});
  const txt=await resp.text(); await log(`📝 update_order: ${order_id} → ${txt}`);
}

async function sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice }) {
  const contract=new web3.eth.Contract(ABI, CONTRACT);
  const valueWei=web3.utils.toWei(String(ethAmount),'ether');
  const gasLimit=await contract.methods.fundTokenFor(user_addr, token_id).estimateGas({from:FROM, value:valueWei});
  const tx={
    from:FROM, to:CONTRACT, value:valueWei,
    data:contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    gas:web3.utils.toHex(gasLimit), gasPrice:web3.utils.toHex(gasPrice),
    nonce:await web3.eth.getTransactionCount(FROM,'pending'), chainId:await web3.eth.getChainId()
  };
  await log(`▶️ TX → fundTokenFor(${user_addr}, ${token_id}) · ${ethAmount} ETH`);
  const signed=await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt=await web3.eth.sendSignedTransaction(signed.rawTransaction);
  try{ fs.appendFileSync('/tmp/fundtx.log', `${Date.now()} ${receipt.transactionHash} token=${token_id}\n`);}catch{}
  await log(`✅ TX: ${receipt.transactionHash}`); return receipt;
}

/* ============== HANDLER ============== */
export default async function handler(req, res) {
  try {
    if (req.method!=='POST') return res.status(405).json({ok:false,error:'POST only'});
    // Security
    const key=(req.headers['x-chainvers-key']||'').toString();
    if (CHAINVERS_KEY && key!==CHAINVERS_KEY) return res.status(403).json({ok:false,error:'Unauthorized'});

    await log('===== CHAINGETCASH START =====');

    const [eurPerEth, gasPrice] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const balanceEth = await getChainBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance ${BALANCE_ADDRESS}: ${balanceEth} ETH`);

    const orders = await fetchOrdersFromIF();
    if (orders.length===0) { await log('ℹ️ Žiadne čakajúce objednávky'); return res.status(200).json({ok:true,balance_eth:balanceEth,funded_count:0}); }

    let funded=0, remaining=balanceEth;
    const chunks=[]; for(let i=0;i<orders.length;i+=PARALLEL_LIMIT) chunks.push(orders.slice(i,i+PARALLEL_LIMIT));

    for(const batch of chunks){
      await Promise.all(batch.map(async (o)=>{
        const order_id  = o.paymentIntentId || o.id || `${o.user_address}_${o.token_id}`;
        const user_addr = o.user_address;
        const token_id  = Number(o.token_id);
        const amount_eur= Number(o.amount ?? o.amount_eur ?? 0);
        if(!user_addr || !token_id){ await log(`⚠️ skip ${order_id}: chýba user_addr/token_id`); return; }

        let ethAmount = MINT_MIN_ETH;
        if (remaining >= MINT_THRESHOLD && amount_eur>0) ethAmount = amount_eur / eurPerEth;
        if (remaining < ethAmount) { await log(`⚠️ nedostatok ETH pre ${order_id} (potr. ${ethAmount}, zostatok ${remaining})`); return; }

        try{
          const receipt = await sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice });
          funded += 1; remaining -= ethAmount;
          await markOrderPaid(order_id, receipt.transactionHash, user_addr);
        }catch(e){ await log(`❌ TX fail ${order_id}: ${e.message}`); }
      }));
    }

    await log(`✅ FUND DONE · funded=${funded} · start=${balanceEth} · ~end=${remaining}`);
    return res.status(200).json({ ok:true, balance_eth:balanceEth, funded_count:funded });

  } catch (err) {
    await log('❌ ERROR:', err.message);
    return res.status(500).json({ ok:false, error: err.message });
  }
}