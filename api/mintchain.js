import crypto from 'crypto';
import https from 'https';
import rlp from 'rlp';
import { keccak256 } from 'js-sha3';
import secp256k1 from 'secp256k1';

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// Validácia Ethereum adresy (základná)
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

const jsonRpcRequest = (method, params) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    });

    const { hostname, pathname } = new URL(process.env.PROVIDER_URL);

    const options = {
      hostname,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            log(`⚠️ RPC Error [${method}]`, json.error);
            return reject(json.error);
          }
          resolve(json.result);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', (e) => {
      log(`❌ RPC ${method} failed:`, e);
      reject(e);
    });

    req.write(data);
    req.end();
  });
};

// Encode funkcie createOriginal(string,string,address)
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // createOriginal(string,string,address)

  const uriHex = Buffer.from(uri, 'utf8').toString('hex').padEnd(64, '0');
  const cropHex = Buffer.from(crop, 'utf8').toString('hex').padEnd(64, '0');
  const addrHex = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');

  return methodID + uriHex + cropHex + addrHex;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    log('❌ Method Not Allowed:', req.method);
    return res.status(405).json({ error: 'Only POST supported' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  if (!metadataURI || !crop_id || !walletAddress) {
    log('❌ Chýbajú vstupné dáta');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }

  if (!isValidAddress(walletAddress)) {
    log('❌ Neplatná cieľová adresa:', walletAddress);
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;
  const PROVIDER_URL = process.env.PROVIDER_URL;

  if (!PRIVATE_KEY || !FROM || !TO || !PROVIDER_URL) {
    log('❌ Chýbajú environment variables');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    log('🔄 Získavam nonce pre:', FROM);
    const nonce = await jsonRpcRequest('eth_getTransactionCount', [FROM, 'latest']);
    log('🔄 Aktuálny nonce:', nonce);

    const gas = await jsonRpcRequest('eth_gasPrice', []);
    log('⛽ Gas price:', gas);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);
    log('📦 Zakódovaný vstup pre createOriginal():', data);

    const tx = [
      nonce,                 // nonce
      gas,                   // gasPrice
      '0x493e0',             // gasLimit: 300000
      TO,                    // to: kontrakt
      '0x0',                 // value
      data,                  // encoded function call
      '0x6f',                // chainId: 111 (Base Sepolia)
      '0x', '0x'             // r, s (prázdne, pred podpisom)
    ];

    const encoded = rlp.encode(tx);
    const hash = Buffer.from(keccak256.arrayBuffer(encoded));
    log('🔐 Hash transakcie (pred podpisom):', hash.toString('hex'));

    const privKey = Buffer.from(PRIVATE_KEY, 'hex');
    const sig = secp256k1.ecdsaSign(hash, privKey);

    const r = sig.signature.slice(0, 32);
    const s = sig.signature.slice(32, 64);
    const v = 111 * 2 + 35 + sig.recid;

    const signedTx = rlp.encode([
      tx[0], tx[1], tx[2], tx[3], tx[4], tx[5],
      `0x${v.toString(16)}`,
      `0x${r.toString('hex')}`,
      `0x${s.toString('hex')}`
    ]);

    const rawTxHex = '0x' + signedTx.toString('hex');

    log('🚀 Posielam podpísanú transakciu...');
    const txHash = await jsonRpcRequest('eth_sendRawTransaction', [rawTxHex]);

    log('✅ Transakcia odoslaná. Hash:', txHash);
    return res.status(200).json({ success: true, txHash });
  } catch (err) {
    log('❌ CHYBA v transakcii:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}