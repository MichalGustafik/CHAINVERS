import { ethers } from 'ethers';

// Funkcia na mintovanie NFT na adresu zákazníka cez Infura
export default async function mintNFT(req, res) {
  const now = new Date().toISOString();
  const log = (...args) => console.log(`[${now}]`, ...args);

  if (req.method !== 'POST') {
    log('❌ [CHYBA] Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Získanie parametrov z požiadavky
  const { metadataURI, crop_id, walletAddress } = req.body;  // metadataURI, crop_id, walletAddress sú potrebné
  
  if (!metadataURI || !walletAddress || !crop_id) {
    log('⚠️ [MINTCHAIN] Chýbajú parametre metadataURI, walletAddress alebo crop_id.');
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Environmentálne premenné
  const PROVIDER_URL = process.env.PROVIDER_URL;  // Infura RPC URL
  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');  // Odstrániť "0x" z privátneho kľúča
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

  if (!PROVIDER_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    log('⚠️ [MINTCHAIN] Chýbajú environment variables.');
    return res.status(400).json({ error: 'Missing environment variables' });
  }

  try {
    // Nastavenie providera a signera cez Ethers.js
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Zakódovanie funkcie mintovania NFT
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);  // Mintujeme NFT na zákazníka

    // Príprava transakcie
    const tx = {
      to: CONTRACT_ADDRESS,
      data: data,
      gasLimit: ethers.BigNumber.from(300000),  // Maximálny gas limit
      value: ethers.BigNumber.from(0),
      nonce: await provider.getTransactionCount(signer.address, 'latest'),
      gasPrice: await provider.getGasPrice(),
      chainId: 84532, // Base Sepolia (testovacia sieť)
    };

    // Podpisovanie transakcie
    const signedTx = await signer.signTransaction(tx);

    // Odoslanie podpísanej transakcie
    const txResponse = await provider.sendTransaction(signedTx);

    log('✅ [MINTCHAIN] Transakcia potvrdená:', txResponse.hash);
    return res.status(200).json({ success: true, txHash: txResponse.hash });
  } catch (err) {
    log('❌ [MINTCHAIN ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// pomocné funkcie
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Keccak256 funkcia "createOriginal(string,string,address)" => prvé 4 bajty

  const uriHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(uri)).padEnd(66, '0'); // URI
  const cropHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(crop)).padEnd(66, '0'); // Crop ID
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0'); // Adresa zákazníka

  return methodID + uriHex + cropHex + addr;
}