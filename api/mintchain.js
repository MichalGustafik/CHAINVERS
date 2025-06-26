import { ethers } from 'ethers';  // Opravený import

// Vytvorenie poskytovateľa RPC
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);

// Funkcia na logovanie s timestampom
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// Skontroluj, či je adresa platná
function isValidAddress(addr) {
  return ethers.utils.isAddress(addr);
}

// Funkcia na získanie poplatkov za gas
async function getGasFees() {
  const feeData = await provider.getFeeData();
  return {
    gasLimit: 250000, // Môžeš nastaviť vlastný limit podľa potreby
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  };
}

// Funkcia na kódovanie dát pre smart kontrakt
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb';
  const uriHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(uri)).padEnd(66, '0');
  const cropHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(crop)).padEnd(66, '0');
  const addrHex = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const fullData = methodID + uriHex + cropHex + addrHex;
  log('Encoded data:', fullData);
  return fullData;
}

export default async function (req, res) {
  log('=============================================');
  log('🔗 MINTCHAIN INIT...');

  if (req.method !== 'POST') {
    log('❌ Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;
  
  log('📥 PRIJATÉ PARAMETRE:');
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

  // Načítanie kľúčov a ďalších premenných z ENV
  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;

  if (!PRIVATE_KEY || !FROM || !TO || !process.env.PROVIDER_URL) {
    log('❌ Chýbajú environment premenné');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  log('🔐 ENVIRONMENT:');
  log('   - FROM:', FROM);
  log('   - TO:', TO);
  log('   - PROVIDER:', process.env.PROVIDER_URL.slice(0, 40) + '...');

  try {
    // Získanie nonce a poplatkov za gas
    const nonce = await provider.getTransactionCount(FROM, 'latest');
    const gasFees = await getGasFees();
    const gasPrice = gasFees.maxFeePerGas;

    log('⛽️ PLYN: nonce =', nonce, ', gasPrice =', gasPrice);

    // Kódovanie dát pre funkciu kontraktu
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    // Príprava transakcie
    const tx = {
      nonce,
      gasLimit: gasFees.gasLimit,
      gasPrice,
      to: TO,
      data,
      value: ethers.BigNumber.from(0),
    };

    // Signovanie transakcie
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const signedTx = await wallet.signTransaction(tx);

    log('🚀 Posielam transakciu...');
    const txHash = await provider.sendTransaction(signedTx);
    log('✅ TX hash:', txHash);

    // Čakanie na potvrdenie transakcie
    log('⏳ Čakanie na potvrdenie...');
    const receipt = await txHash.wait();
    log('📦 Potvrdená: blockNumber =', receipt.blockNumber);

    return res.status(200).json({
      success: true,
      txHash: txHash.hash,
      recipient: walletAddress,
      metadataURI,
      receipt
    });

  } catch (err) {
    log('❌ Výnimka:', err.message);
    return res.status(500).json({ error: err.message });
  }
}