import { ethers } from 'ethers';

const log = (...args) =>
  console.log(`[${new Date().toISOString()}]`, ...args);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  log('🔗 MINTCHAIN AKTIVOVANÝ');
  log('📥 Prijaté údaje:\n   - metadataURI:', metadataURI, '\n   - crop_id:', crop_id, '\n   - walletAddress:', walletAddress);

  const FROM = process.env.FROM_ADDRESS;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const PROVIDER_URL = process.env.PROVIDER_URL;
  const INFURA_GAS_API = process.env.INFURA_GAS_API;

  log('🌍 ENV nastavenia:\n   - FROM_ADDRESS:', FROM, '\n   - CONTRACT_ADDRESS:', CONTRACT_ADDRESS, '\n   - PROVIDER_URL:', PROVIDER_URL);

  if (!FROM || !PRIVATE_KEY || !CONTRACT_ADDRESS || !PROVIDER_URL) {
    return res.status(500).json({ error: 'Chýbajú ENV premenné' });
  }

  try {
    const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const balance = await provider.getBalance(FROM);
    const chainId = await provider.getNetwork();
    log(`🔎 Chain ID: ${chainId.chainId}`);
    log(`🏦 Zostatok: ${ethers.utils.formatEther(balance)} ETH`);

    if (balance.eq(0)) {
      return res.status(500).json({
        error: 'Mintovanie zlyhalo',
        detail: {
          error: 'Insufficient ETH for gas fees',
          requiredETH: 'neznáme',
          walletBalance: '0',
        },
      });
    }

    const abi = [
      'function createOriginal(string memory imageURI, string memory cropId, address to) public',
    ];

    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

    // Získaj gas price z Infura Gas API
    let gasPrice;
    try {
      const response = await fetch(`${INFURA_GAS_API}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const gasData = await response.json();
      gasPrice = ethers.BigNumber.from(gasData.estimatedPrices[0].price).mul(
        1e9
      ); // Gwei -> Wei
      log('⛽️ Gas price z Infura:', gasPrice.toString());
    } catch (e) {
      gasPrice = await provider.getGasPrice();
      log('⚠️ Infura Gas API zlyhalo, použitý fallback:', gasPrice.toString());
    }

    const gasEstimate = await contract.estimateGas.createOriginal(
      metadataURI,
      crop_id,
      walletAddress
    );
    log('⛽️ Odhadovaný gas:', gasEstimate.toString());

    const tx = await contract.createOriginal(metadataURI, crop_id, walletAddress, {
      gasLimit: gasEstimate,
      gasPrice: gasPrice,
    });

    log('🚀 Transakcia odoslaná:', tx.hash);

    const receipt = await tx.wait();
    log('✅ Transakcia potvrdená:', receipt.transactionHash);

    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
    });
  } catch (error) {
    log('❌ Výnimka:', error);
    return res.status(500).json({
      error: 'Mintovanie zlyhalo',
      detail: error,
    });
  }
}