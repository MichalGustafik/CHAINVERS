import crypto from 'crypto';
import https from 'https';
import rlp from 'rlp';
import sha3 from 'js-sha3';
import secp256k1 from 'secp256k1';

const { keccak256 } = sha3;

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

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
          if (parsed.error) return reject(new Error(parsed.error.message));
          log('📨 RPC odpoveď:', parsed.result);
          resolve(parsed.result);
        } catch (e) {
          log('❌ [CHYBA] Neplatný JSON z RPC:', raw.slice(0, 80));
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

function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // createOriginal(string,string,address)
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
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  log('📥 Prijaté údaje:');
  log('   - metadataURI:', metadataURI);
  log('   - crop_id:', crop_id);
  log('   - walletAddress:', walletAddress);

  if (!metadataURI || !crop_id || !walletAddress) {
    log('⚠️ Neúplné vstupné údaje');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }

  if (!isValidAddress(walletAddress)) {
    log('⚠️ Neplatná adresa:', walletAddress);
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;
  const PROVIDER_URL = process.env.PROVIDER_URL;

  if (!PRIVATE_KEY || !FROM || !TO || !PROVIDER_URL) {
    log('❌ Chýbajú environment variables');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  log('🌍 ENV nastavenia:');
  log('   - FROM_ADDRESS:', FROM);
  log('   - CONTRACT_ADDRESS:', TO);
  log('   - PROVIDER_URL:', PROVIDER_URL.slice(0, 40) + '...');

  try {
    const nonce = await jsonRpcRequest('eth_getTransactionCount', [FROM, 'latest']);
    const gasPrice = await jsonRpcRequest('eth_gasPrice', []);

    log('⛽️ PLYN (Gas):');
    log('   - nonce:', nonce);
    log('   - gasPrice (wei):', gasPrice);
    log('   - gasPrice (gwei):', parseInt(gasPrice, 16) / 1e9);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    const tx = [
      nonce,                   // nonce
      gasPrice,                // gasPrice
      '0x493e0',               // gasLimit (300000)
      TO,                      // to
      '0x0',                   // value
      data,                    // data
      '0x6f',                  // chainId (Base Sepolia = 111)
      '0x',                    // r
      '0x'                     // s
    ];

    const encodedTx = rlp.encode(tx);
    const txHash = Buffer.from(keccak256.arrayBuffer(encodedTx));

    const privKeyBuf = Buffer.from(PRIVATE_KEY, 'hex');
    const { signature, recid } = secp256k1.ecdsaSign(txHash, privKeyBuf);

    const r = '0x' + Buffer.from(signature.slice(0, 32)).toString('hex');
    const s = '0x' + Buffer.from(signature.slice(32, 64)).toString('hex');
    const v = 111 * 2 + 35 + recid; // Base Sepolia

    const signedTx = rlp.encode([
      tx[0],              // nonce
      tx[1],              // gasPrice
      tx[2],              // gasLimit
      tx[3],              // to
      tx[4],              // value
      tx[5],              // data
      '0x' + v.toString(16), // v (as hex)
      r,
      s
    ]);

    const rawTxHex = '0x' + signedTx.toString('hex');

    log('🚀 Posielam transakciu...');
    const txHashFinal = await jsonRpcRequest('eth_sendRawTransaction', [rawTxHex]);
    log('✅ TX hash:', txHashFinal);

    log('⏳ Čakanie na potvrdenie...');
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      receipt = await jsonRpcRequest('eth_getTransactionReceipt', [txHashFinal]);
      if (receipt) break;
    }

    if (!receipt) {
      log('⚠️ Transakcia nepotvrdená po 60s');
    } else {
      log('📦 Potvrdená: blockNumber =', receipt.blockNumber);
    }

    log('🏁 MINT dokončený');
    log('=============================================');

    return res.status(200).json({
      success: true,
      txHash: txHashFinal,
      metadataURI,
      recipient: walletAddress,
      receipt
    });
  } catch (err) {
    log('❌ Výnimka:', err.message);
    return res.status(500).json({ error: err.message });
  }
}