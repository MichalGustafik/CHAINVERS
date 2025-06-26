import fetch from 'node-fetch';
import { ethers } from 'ethers';

// Funkcia na získanie ceny plynu z Infura Gas API
async function getGasPrice() {
  const url = process.env.INFURA_GAS_API;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.result && data.result.ProposeGasPrice) {
      const gasPriceInGwei = data.result.ProposeGasPrice;
      console.log("[INFO] Aktuálna cena plynu (Gwei):", gasPriceInGwei);
      return gasPriceInGwei; // Vráti cenu plynu
    } else {
      console.error("[ERROR] Chyba pri získavaní ceny plynu z Infura Gas API");
    }
  } catch (error) {
    console.error("[ERROR] Chyba pri volaní Infura Gas API:", error);
  }
}

// Funkcia na podpisovanie a odosielanie transakcie
export default async function handler(req, res) {
  const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

  if (req.method !== 'POST') {
    log('❌ Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;
  log('📥 PRIJATÉ PARAMETRE:', { metadataURI, crop_id, walletAddress });

  if (!metadataURI || !crop_id || !walletAddress) {
    log('⚠️ Neúplné údaje');
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
    log('❌ Chýbajú environment premenné');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  log('🌍 ENV nastavenia:', { FROM, TO, PROVIDER_URL: PROVIDER_URL.slice(0, 40) + '...' });

  try {
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Získanie ceny plynu z Infura Gas API
    const gasPrice = await getGasPrice();

    // Získanie nonce pre transakciu
    const nonce = await provider.getTransactionCount(FROM, 'latest');
    log('⛽️ PLYN (Gas):', { nonce, gasPrice });

    // Zakódovanie funkcie pre mintovanie
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);
    const gasLimit = 3000000; // Predpokladaný gas limit pre túto transakciu

    // Príprava transakcie
    const tx = {
      nonce,
      gasLimit,
      gasPrice: ethers.utils.parseUnits(gasPrice.toString(), 'gwei'),
      to: TO,
      value: ethers.BigNumber.from(0),
      data,
      chainId: 11155111 // Sepolia testnet
    };

    log('🚀 Posielam transakciu...');

    // Podpisovanie a odoslanie transakcie
    const txResponse = await signer.sendTransaction(tx);
    log('✅ TX Hash:', txResponse.hash);

    // Čakanie na potvrdenie transakcie
    const receipt = await txResponse.wait();
    log('📦 Transakcia potvrdená:', { blockNumber: receipt.blockNumber });

    return res.status(200).json({
      success: true,
      txHash: txResponse.hash,
      metadataURI,
      blockNumber: receipt.blockNumber
    });
  } catch (err) {
    log('❌ Chyba pri spracovaní transakcie:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Funkcia na kontrolu platnosti adresy
function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// Funkcia na zakódovanie funkcie mintovania
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Prvé 4 bajty z hash funkcie "createOriginal(string,string,address)"
  const uriHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(uri)).padEnd(66, '0');
  const cropHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(crop)).padEnd(66, '0');
  const addrHex = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');

  return methodID + uriHex + cropHex + addrHex;
}