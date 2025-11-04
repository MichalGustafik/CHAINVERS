import Web3 from 'web3';
import fetch from 'node-fetch';

// ===== ENV =====
const PROVIDER_URL   = process.env.PROVIDER_URL;         // RPC (Alchemy/Infura…)
const PRIVATE_KEY    = process.env.PRIVATE_KEY;
const FROM           = process.env.FROM_ADDRESS;
const CONTRACT       = process.env.CONTRACT_ADDRESS;
const INFURA_API_KEY = process.env.INFURA_API_KEY;       // voliteľné (gas API)
const INF_FREE_URL   = process.env.INF_FREE_URL;         // https://tvoj-if-domen (s protokolom)

// ===== WEB3 =====
const web3 = new Web3(PROVIDER_URL);

// ===== ABI =====
const ABI = [
  {
    type: 'function',
    name: 'fundTokenFor',
    inputs: [
      { type: 'address', name: 'user' },
      { type: 'uint256', name: 'tokenId' },
    ],
  },
];

export const config = { api: { bodyParser: true } };

// -------- LOG → priamo do accptpay.php?action=save_log ----------
async function sendLog(message) {
  try {
    if (!INF_FREE_URL) return;
    const url = `${INF_FREE_URL}/accptpay.php?action=save_log`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message }),
    });
  } catch (e) {
    console.error('Log transfer failed:', e.message);
  }
}
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  sendLog(line); // fire-and-forget
};

// -------- 1) kurz ETH/EUR ----------
async function getEurEthRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    if (!rate) throw new Error('rate missing');
    log(`💱 1 ETH = ${rate} EUR`);
    return rate;
  } catch (e) {
    log('⚠️ CoinGecko fail, fallback 2500 EUR');
    return 2500;
  }
}

// -------- 2) gas price ----------
async function getGasPrice() {
  try {
    if (INFURA_API_KEY) {
      const r = await fetch(`https://gas.api.infura.io/v3/${INFURA_API_KEY}`);
      const j = await r.json();
      const gwei = j?.data?.fast?.maxFeePerGas ?? null;
      if (gwei) {
        const wei = web3.utils.toWei(Number(gwei).toFixed(0), 'gwei');
        log(`⛽ Gas (Infura): ${gwei} GWEI`);
        return wei;
      }
    }
  } catch (e) {
    log('⚠️ Infura gas fallback:', e.message);
  }
  const gasPrice = await web3.eth.getGasPrice();
  log(`⛽ Gas (RPC): ${web3.utils.fromWei(gasPrice, 'gwei')} GWEI`);
  return gasPrice;
}

// -------- 3) dočítaj objednávku z IF, ak net prišla v body ----------
async function getOrderData(order_id) {
  if (!INF_FREE_URL) throw new Error('INF_FREE_URL not set');
  const url = `${INF_FREE_URL}/chainuserdata/orders/${order_id}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Order not found (${order_id})`);
  const j = await r.json();
  log(`📦 order ${order_id} → token ${j.token_id}, user ${j.user_addr}, amount ${j.amount_eur ?? j.amount}`);
  return j;
}

// -------- 4) odoslanie ETH do kontraktu ----------
async function sendEthToNFT({ user_addr, token_id, ethAmount }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(ethAmount.toString(), 'ether');
  const gasPrice = await getGasPrice();

  const gasLimit = await contract.methods
    .fundTokenFor(user_addr, token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const chainId = await web3.eth.getChainId();
  const nonce   = await web3.eth.getTransactionCount(FROM);

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

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  log(`✅ TX done: ${receipt.transactionHash}`);
  return receipt;
}

// -------- 5) spätná aktualizácia IF ----------
async function markOrderFunded(order_id, tx_hash) {
  if (!INF_FREE_URL) return 'INF_FREE_URL not set';
  const updateUrl = `${INF_FREE_URL}/update_order.php`;
  const body = new URLSearchParams({ order_id, tx_hash });
  const resp = await fetch(updateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const txt = await resp.text();
  log(`📝 Updated order on server: ${txt}`);
  return txt;
}

// -------- 6) handler ----------
export default async function handler(req, res) {
  try {
    // GET ?action=logs → vracia log z IF (proxy môžeš dorobiť, ak chceš)
    if (req.method === 'GET' && (req.query?.action === 'logs')) {
      if (!INF_FREE_URL) return res.status(200).send('INF_FREE_URL not set');
      const url = `${INF_FREE_URL}/accptpay.php?action=read_log`;
      try {
        const r = await fetch(url);
        const txt = await r.text();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(txt || '');
      } catch (e) {
        return res.status(200).send('(log je prázdny alebo nedostupný)');
      }
    }

    log('===== CHAINGETCASH START =====');

    const order_id   = req.body?.order_id || req.query?.order_id;
    const user_addr  = req.body?.user_addr;
    const token_id   = req.body?.token_id;
    const amount_eur = req.body?.amount_eur;

    if (!order_id) return res.status(400).json({ ok:false, error: 'Missing order_id' });

    let order = { user_addr, token_id, amount_eur };
    if (!order.user_addr || !order.token_id || !order.amount_eur) {
      const fetched = await getOrderData(order_id);
      order.user_addr  = order.user_addr  || fetched.user_addr;
      order.token_id   = order.token_id   || fetched.token_id;
      order.amount_eur = order.amount_eur ?? (fetched.amount_eur ?? fetched.amount);
    }

    if (!order.user_addr || !order.token_id || !order.amount_eur) {
      return res.status(400).json({ ok:false, error: 'Incomplete order data' });
    }

    const eurPerEth = await getEurEthRate();
    const ethAmount = Number(order.amount_eur) / eurPerEth;
    log(`💰 ${order.amount_eur} € = ${ethAmount} ETH`);

    const receipt = await sendEthToNFT({
      user_addr: order.user_addr,
      token_id:  order.token_id,
      ethAmount
    });

    await markOrderFunded(order_id, receipt.transactionHash);

    return res.status(200).json({
      ok: true,
      order_id,
      token_id: order.token_id,
      user_addr: order.user_addr,
      sent_eth: ethAmount,
      tx_hash: receipt.transactionHash,
    });
  } catch (err) {
    log('❌ ERROR:', err.message);
    return res.status(500).json({ ok:false, error: err.message });
  }
}