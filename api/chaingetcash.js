// /api/chainmintcheck.js
import Web3 from 'web3';
import fetch from 'node-fetch';
import fs from 'fs';

// ===== ENV =====
const PROVIDER_URL    = process.env.PROVIDER_URL;
const PRIVATE_KEY     = process.env.PRIVATE_KEY;
const FROM            = process.env.FROM_ADDRESS;
const CONTRACT        = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY  = process.env.INFURA_API_KEY;        // optional
const INF_FREE_URL    = process.env.INF_FREE_URL;          // https://your-inf.free.nf
const CHAINVERS_KEY   = process.env.CHAINVERS_KEY || '';   // shared secret IF <-> Vercel

// Mint policy
const MINT_THRESHOLD  = Number(process.env.MINT_THRESHOLD ?? '0.05');  // ETH
const MINT_MIN_ETH    = Number(process.env.MINT_MIN_ETH  ?? '0.0001'); // ETH fallback
const BALANCE_ADDRESS = process.env.BALANCE_ADDRESS || CONTRACT;       // kde sa overuje balance
const PARALLEL_LIMIT  = Number(process.env.MINT_PARALLEL ?? '1');      // bezpečne 1 (FIFO)

// ===== WEB3 =====
const web3 = new Web3(PROVIDER_URL);

// ===== ABI =====
const ABI = [
  { type:'function', name:'fundTokenFor', inputs:[
    { type:'address', name:'user' },
    { type:'uint256', name:'tokenId' },
  ]}
];

export const config = { api: { bodyParser: true } };

// ---------- logging to IF ----------
async function sendLog(message) {
  try {
    if (!INF_FREE_URL) return;
    const url = `${INF_FREE_URL}/accptpay.php?action=save_log`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action:'save_log', message }),
    });
  } catch (e) {
    console.error('Log transfer failed:', e.message);
  }
}
const log = async (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  await sendLog(line);
};

// ---------- helpers ----------
async function getEurEthRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    if (!rate) throw new Error('rate missing');
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate;
  } catch {
    await log('⚠️ CoinGecko fail, fallback 2500 EUR');
    return 2500;
  }
}

async function getGasPrice() {
  try {
    if (INFURA_API_KEY) {
      const r = await fetch(`https://gas.api.infura.io/v3/${INFURA_API_KEY}`);
      const j = await r.json();
      const gwei = j?.data?.fast?.maxFeePerGas ?? null;
      if (gwei) {
        const wei = web3.utils.toWei(Number(gwei).toFixed(0), 'gwei');
        await log(`⛽ Gas (Infura): ${gwei} GWEI`);
        return wei;
      }
    }
  } catch (e) {
    await log('⚠️ Infura gas fallback:', e.message);
  }
  const gasPrice = await web3.eth.getGasPrice();
  await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gasPrice, 'gwei')} GWEI`);
  return gasPrice;
}

async function getChainBalanceEth(address) {
  const wei = await web3.eth.getBalance(address);
  return Number(web3.utils.fromWei(wei, 'ether'));
}

async function fetchOrdersFromIF() {
  if (!INF_FREE_URL) throw new Error('INF_FREE_URL not set');
  const url = `${INF_FREE_URL}/accptpay.php`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action:'refresh' })
  });
  if (!resp.ok) throw new Error(`IF refresh failed: ${resp.status}`);
  const list = await resp.json();
  if (!Array.isArray(list)) throw new Error('orders invalid');
  // filter: not paid, has token_id
  const pending = list.filter(o => (o.status !== '💰 Zaplatené') && o.token_id);
  // FIFO by created_at asc + price asc + token_id asc (UI already sorted, but enforce)
  pending.sort((a,b)=>{
    const da = (new Date(a.created_at||0)) - (new Date(b.created_at||0));
    if (da!==0) return da;
    const pa = (+a.amount||0) - (+b.amount||0);
    if (pa!==0) return pa;
    return (+a.token_id||0) - (+b.token_id||0);
  });
  return pending;
}

async function markOrderFunded(order_id, tx_hash, user_addr) {
  if (!INF_FREE_URL) return;
  const updateUrl = `${INF_FREE_URL}/update_order.php`;
  const headers = {
    'Content-Type':'application/x-www-form-urlencoded',
  };
  if (CHAINVERS_KEY) headers['X-CHAINVERS-KEY'] = CHAINVERS_KEY;
  const body = new URLSearchParams({ order_id, tx_hash, user_addr });
  const resp = await fetch(updateUrl, { method:'POST', headers, body });
  const txt  = await resp.text();
  await log(`📝 update_order: ${order_id} → ${txt}`);
}

async function sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(ethAmount.toString(), 'ether');

  const gasLimit = await contract.methods
    .fundTokenFor(user_addr, token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const chainId = await web3.eth.getChainId();
  const nonce   = await web3.eth.getTransactionCount(FROM, 'pending');

  const tx = {
    from: FROM,
    to: CONTRACT,
    data: contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    value: valueWei,
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    chainId,
    nonce,
  };

  const signed  = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash} (token_id=${token_id})`);
  try { fs.appendFileSync('/tmp/chaintx.log', `${Date.now()} ${receipt.transactionHash}\n`); } catch {}
  return receipt;
}

/* ------------ MAIN HANDLER ------------ */
export default async function handler(req, res) {
  try {
    // Security: require shared key
    const hdr = (req.headers['x-chainvers-key'] || '').toString();
    if (CHAINVERS_KEY && hdr !== CHAINVERS_KEY) {
      return res.status(403).json({ ok:false, error:'Unauthorized' });
    }

    await log('===== CHAINMINTCHECK START =====');

    // 1) Sources
    const [eurPerEth, gasPrice] = await Promise.all([ getEurEthRate(), getGasPrice() ]);

    // 2) Balance
    const balanceEth = await getChainBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance @${BALANCE_ADDRESS}: ${balanceEth} ETH`);

    // 3) Orders
    const orders = await fetchOrdersFromIF();
    if (orders.length === 0) {
      await log('ℹ️ Žiadne čakajúce objednávky');
      return res.status(200).json({ ok:true, balance_eth: balanceEth, minted_count: 0 });
    }

    // 4) Mint process
    let minted = 0;
    let remainingBalance = balanceEth;

    // Concurrency (safe-by-default = 1)
    const chunks = [];
    for (let i=0; i<orders.length; i+=PARALLEL_LIMIT) chunks.push(orders.slice(i, i+PARALLEL_LIMIT));

    for (const batch of chunks) {
      await Promise.all(batch.map(async (o) => {
        const order_id  = o.paymentIntentId || o.id || `order_${o.user_address}_${o.token_id}`;
        const user_addr = o.user_address;
        const token_id  = Number(o.token_id);
        const amount_eur= Number(o.amount ?? o.amount_eur ?? 0);

        if (!user_addr || !token_id) {
          await log(`⚠️ Skip order ${order_id}: chýba user_addr/token_id`);
          return;
        }

        let ethAmount = MINT_MIN_ETH;
        if (remainingBalance >= MINT_THRESHOLD && amount_eur > 0) {
          ethAmount = amount_eur / eurPerEth;
        }

        if (remainingBalance < ethAmount) {
          await log(`⚠️ Nedostatok ETH pre ${order_id} (potr. ${ethAmount}, zostatok ${remainingBalance})`);
          return;
        }

        await log(`▶️ Mint: order=${order_id} user=${user_addr} token=${token_id} send=${ethAmount} ETH`);
        try {
          const receipt = await sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice });
          minted += 1;
          remainingBalance -= ethAmount;
          await markOrderFunded(order_id, receipt.transactionHash, user_addr);
        } catch (e) {
          await log(`❌ TX fail ${order_id}: ${e.message}`);
        }
      }));
    }

    await log(`✅ MINT DONE · minted=${minted} · balance_start=${balanceEth} · balance_est_end≈${remainingBalance}`);

    return res.status(200).json({
      ok: true,
      balance_eth: balanceEth,
      minted_count: minted
    });

  } catch (err) {
    await log('❌ ERROR:', err.message);
    return res.status(500).json({ ok:false, error: err.message });
  }
}