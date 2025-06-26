import { ethers } from 'ethers'; // Správne importovanie ethers knižnice

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb';

  // Hexlifikujeme údaje do správneho formátu
  const uriHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(uri)).padEnd(66, '0');
  const cropHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(crop)).padEnd(66, '0');
  const addrHex = ethers.utils.getAddress(to).replace(/^0x/, '').padStart(64, '0');

  // Spojíme všetky zakódované hodnoty do jedného hex stringu
  const fullData = methodID + uriHex + cropHex + addrHex;

  log('Encoded data:', fullData);
  return fullData;
}

// Funkcia pre testovanie a vykonanie transakcie
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

  if (!ethers.utils.isAddress(walletAddress)) {
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

  log('🔐 ENVIRONMENT:');
  log('   - FROM:', FROM);
  log('   - TO:', TO);
  log('   - PROVIDER:', PROVIDER_URL.slice(0, 40) + '...');

  try {
    const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
    const nonce = await provider.getTransactionCount(FROM, 'latest');
    const gasPrice = await provider.getGasPrice();

    log('⛽️ PLYN: nonce =', nonce, ', gasPrice =', gasPrice);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    const tx = {
      nonce,
      gasLimit: 250000, // Nastav vlastný gas limit
      gasPrice,
      to: TO,
      data,
      value: ethers.BigNumber.from(0),
    };

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const signedTx = await wallet.signTransaction(tx);

    log('🚀 Posielam transakciu...');
    const txHash = await provider.sendTransaction(signedTx);
    log('✅ TX hash:', txHash);

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