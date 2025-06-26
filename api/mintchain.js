import crypto from 'crypto';
import https from 'https';
import rlp from 'rlp';
import { keccak256 } from 'js-sha3';
import secp256k1 from 'secp256k1';

// 🪵 Logovanie s časovou značkou
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// 📬 Kontrola správneho formátu adresy
function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// 📡 RPC požiadavka na Infura alebo iný provider
const jsonRpcRequest = (method, params) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(process.env.PROVIDER_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            log('❌ [RPC CHYBA]', parsed.error.message);
            return reject(new Error(parsed.error.message));
          }
          log('📨 RPC odpoveď:', parsed.result);
          resolve(parsed.result);
        } catch (e) {
          log('❌ [CHYBA] Neplatný JSON:', raw.slice(0, 80));
          reject(new Error('Invalid JSON response from RPC'));
        }
      });
    });

    req.on('error', (err) => {
      log('❌ [CHYBA] RPC pripojenie zlyhalo:', err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
};

// 🎛️ Funkcia na zakódovanie mintovania
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Keccak256("createOriginal(string,string,address)").slice(0,10)
  const uriHex = Buffer.from(uri, 'utf8').toString('hex').padEnd(64, '0');
  const cropHex = Buffer.from(crop, 'utf8').toString('hex').padEnd(64, '0');
  const addrHex = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const fullData = methodID + uriHex + cropHex + addrHex;

  log('🧬 encodeFunctionCall():');
  log('   - metadataURI (hex):', uriHex);
  log('   - crop_id     (hex):', cropHex);
  log('   - address     (hex):', addrHex);
  log('   → Encoded data:', fullData);

  return fullData;
}

export default async function handler(req, res) {
  log('=============================================');
  log('🔗 MINTCHAIN AKTIVOVANÝ');

  if (req.method !== 'POST') {
    log('❌ Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Only POST supported' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  log('📥 Prijaté údaje:');
  log('   - metadataURI:', metadataURI);
  log('   - crop_id:', crop_id);
  log('   - walletAddress:', walletAddress);

  if (!metadataURI || !crop_id || !walletAddress) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  if (!isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;
  const PROVIDER_URL = process.env.PROVIDER_URL;

  log('🌍 ENV nastavenia:');
  log('   - FROM_ADDRESS:', FROM);
  log('   - CONTRACT_ADDRESS:', TO);
  log('   - PROVIDER_URL:', PROVIDER_URL?.slice(0, 40) + '...');

  if (!PRIVATE_KEY || !FROM || !TO || !PROVIDER_URL) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // 🧾 1. Získanie nonce a gasPrice
    const nonce = await jsonRpcRequest('eth_getTransactionCount', [FROM, 'latest']);
    const gasPrice = await jsonRpcRequest('eth_gasPrice', []);

    log('⛽️ PLYN (Gas):');
    log('   - nonce:', nonce);
    log('   - gasPrice (wei):', gasPrice);
    log('   - gasPrice (gwei):', parseInt(gasPrice, 16) / 1e9);

    // 🎛️ 2. Zakódovanie funkcie
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    // 📦 3. Príprava transakcie
    const tx = [
      nonce,
      gasPrice,
      '0x493e0',     // gasLimit (300000)
      TO,
      '0x0',         // value
      data,
      '0x6f',        // chainId = 111
      '0x', '0x'     // r, s
    ];

    const encodedTx = rlp.encode(tx);
    const txHash = Buffer.from(keccak256.arrayBuffer(encodedTx));

    log('🔐 HASH transakcie:', txHash.toString('hex'));

    // ✍️ 4. Podpis
    const privKeyBuf = Buffer.from(PRIVATE_KEY, 'hex');
    const signature = secp256k1.ecdsaSign(txHash, privKeyBuf);
    const r = signature.signature.slice(0, 32);
    const s = signature.signature.slice(32, 64);
    const v = 111 * 2 + 35 + signature.recid;

    log('✍️ Podpis:');
    log('   - r:', r.toString('hex'));
    log('   - s:', s.toString('hex'));
    log('   - v:', v);

    // 🧾 5. RLP podpísaná transakcia
    const signedTx = rlp.encode([
      tx[0], tx[1], tx[2], tx[3], tx[4], tx[5],
      `0x${v.toString(16)}`,
      `0x${r.toString('hex')}`,
      `0x${s.toString('hex')}`
    ]);

    const rawTxHex = '0x' + signedTx.toString('hex');

    log('🚀 Posielam transakciu...');

    // 🚀 6. Odošleme transakciu
    const txHashFinal = await jsonRpcRequest('eth_sendRawTransaction', [rawTxHex]);

    log('✅ Transakcia odoslaná:');
    log('   - txHash:', txHashFinal);
    log('   - prijímateľ NFT:', walletAddress);
    log('   - metadata CID:', metadataURI);

    // ⏳ 7. Čakanie na potvrdenie transakcie
    log('⏳ Čakám na potvrdenie transakcie...');
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000)); // počkaj 2 sekundy
      receipt = await jsonRpcRequest('eth_getTransactionReceipt', [txHashFinal]);
      if (receipt) break;
    }

    if (!receipt) {
      log('⚠️ Transakcia stále nepotvrdená. Skontroluj manuálne neskôr.');
    } else {
      log('📦 Transakcia potvrdená:');
      log('   - blockNumber:', receipt.blockNumber);
      log('   - gasUsed:', receipt.gasUsed);
    }

    log('=============================================');

    return res.status(200).json({
      success: true,
      txHash: txHashFinal,
      recipient: walletAddress,
      metadataURI,
      receipt
    });
  } catch (err) {
    log('❌ CHYBA:', err.message);
    log('=============================================');
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}