import fetch from 'node-fetch';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import rlp from 'rlp';

// Helper pre logovanie
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// Funkcia pre validáciu Ethereum adresy
function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// Funkcia na odoslanie požiadavky na Infura
async function jsonRpcRequest(method, params) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });
  const url = process.env.PROVIDER_URL;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  const jsonResponse = await response.json();
  if (jsonResponse.error) {
    throw new Error(jsonResponse.error.message);
  }
  return jsonResponse.result;
}

// Funkcia pre kódovanie funkcie pre mintovanie NFT
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Keccak256 funkcia "createOriginal(string,string,address)" => prvé 4 bajty
  const uriHex = Buffer.from(uri, 'utf8').toString('hex').padEnd(64, '0'); // URI
  const cropHex = Buffer.from(crop, 'utf8').toString('hex').padEnd(64, '0'); // Crop ID
  const addrHex = to.toLowerCase().replace(/^0x/, '').padStart(64, '0'); // Adresa zákazníka
  return methodID + uriHex + cropHex + addrHex;
}

// Hlavná funkcia na mintovanie NFT cez Infura
export default async function mintNFT(req, res) {
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
    log('⚠️ Neúplné údaje');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }

  if (!isValidAddress(walletAddress)) {
    log('⚠️ Neplatná adresa:', walletAddress);
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  const PROVIDER_URL = process.env.PROVIDER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');  // Odstrániť "0x" z privátneho kľúča
  const FROM = process.env.FROM_ADDRESS;  // Adresa zoktvorenia transakcie
  const TO = process.env.CONTRACT_ADDRESS;  // Adresa smart kontraktu

  if (!PRIVATE_KEY || !FROM || !TO || !PROVIDER_URL) {
    log('❌ Chýbajú environment premenné');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // Získanie nonce a gas ceny
    const nonce = await jsonRpcRequest('eth_getTransactionCount', [FROM, 'latest']);
    const gasPrice = await jsonRpcRequest('eth_gasPrice', []);
    
    log('⛽️ PLYN (Gas):');
    log('   - nonce:', nonce);
    log('   - gasPrice (wei):', gasPrice);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    const tx = [
      nonce,
      gasPrice,
      '0x493e0', // Odoslanie ETH (ale nebudeme ho posielať)
      TO,
      '0x0', // Posielame 0 ETH
      data,
      '0x6f', // Maximálny gas limit
      '0x', '0x'
    ];

    const encodedTx = rlp.encode(tx);  // Zakódujeme transakciu
    const txHash = Buffer.from(crypto.createHash('sha256').update(encodedTx).digest());  // Vytvárame hash transakcie

    const privKeyBuf = Buffer.from(PRIVATE_KEY, 'hex');
    const signature = secp256k1.ecdsaSign(txHash, privKeyBuf);
    const r = signature.signature.slice(0, 32);
    const s = signature.signature.slice(32, 64);
    const v = 27 + signature.recid;

    const signedTx = rlp.encode([
      tx[0], tx[1], tx[2], tx[3], tx[4], tx[5],
      `0x${v.toString(16)}`,
      `0x${r.toString('hex')}`,
      `0x${s.toString('hex')}`
    ]);

    const rawTxHex = '0x' + signedTx.toString('hex');

    log('🚀 Posielam transakciu...');
    const txHashFinal = await jsonRpcRequest('eth_sendRawTransaction', [rawTxHex]);

    log('✅ TX hash:', txHashFinal);

    log('⏳ Čakanie na potvrdenie...');
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));  // Počkáme 2 sekundy medzi pokusmi
      receipt = await jsonRpcRequest('eth_getTransactionReceipt', [txHashFinal]);
      if (receipt) break;
    }

    if (!receipt) {
      log('⚠️ Transakcia nepotvrdená po 60s');
    } else {
      log('📦 Potvrdená: blockNumber =', receipt.blockNumber);
    }

    return res.status(200).json({
      success: true,
      txHash: txHashFinal,
      metadataURI,
      receipt
    });

  } catch (err) {
    log('❌ Výnimka:', err.message);
    return res.status(500).json({ error: 'Interná chyba servera', detail: err.message });
  }
}