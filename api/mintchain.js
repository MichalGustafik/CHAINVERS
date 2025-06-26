import { ethers } from 'ethers';

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

export default async function handler(req, res) {
  log('=============================================');
  log('🔗 MINTCHAIN AKTIVOVANÝ');

  if (req.method !== 'POST') {
    log('❌ Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  log('📥 Prijaté údaje:');
  log('   - metadataURI:', metadataURI);
  log('   - crop_id:', crop_id);
  log('   - walletAddress:', walletAddress);

  if (!metadataURI || !crop_id || !walletAddress) {
    log('⚠️ Chýbajú požadované údaje.');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
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
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const contractInterface = new ethers.utils.Interface([
      'function createOriginal(string memory imageURI, string memory cropId, address to)'
    ]);

    const txData = contractInterface.encodeFunctionData('createOriginal', [
      metadataURI,
      crop_id,
      walletAddress
    ]);

    const tx = {
      to: TO,
      data: txData,
      value: 0,
      gasLimit: 300000,
    };

    log('🚀 Posielam transakciu...');
    const txResponse = await wallet.sendTransaction(tx);
    log('✅ Transakcia hash:', txResponse.hash);

    log('⏳ Čakanie na potvrdenie...');
    const receipt = await txResponse.wait();
    log('📦 Transakcia potvrdená v bloku:', receipt.blockNumber);

    return res.status(200).json({
      success: true,
      txHash: txResponse.hash,
      metadataURI,
      recipient: walletAddress,
      blockNumber: receipt.blockNumber
    });
  } catch (err) {
    log('❌ Výnimka:', err.message);
    return res.status(500).json({ error: err.message });
  }
}