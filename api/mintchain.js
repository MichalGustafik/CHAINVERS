import { ethers } from 'ethers';

// Funkcia na získanie nonce a gas ceny z Infura RPC
async function jsonRpcRequest(method, params) {
  const url = process.env.PROVIDER_URL; // Infura RPC URL
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });

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

// Funkcia na encodeovanie funkcie mintovania (RLP)
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Keccak256 funkcia "createOriginal(string,string,address)" => prvé 4 bajty
  const uriHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(uri)).padEnd(66, '0'); // URI
  const cropHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(crop)).padEnd(66, '0'); // Crop ID
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0'); // Adresa zákazníka

  return methodID + uriHex + cropHex + addr;
}

// Funkcia na mintovanie NFT
export default async function mintNFT(req, res) {
  console.log('=============================================');
  console.log('🔗 MINTCHAIN AKTIVOVANÝ');

  if (req.method !== 'POST') {
    console.log('❌ Nepodporovaná HTTP metóda:', req.method);
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  console.log('📥 Prijaté údaje:');
  console.log('   - metadataURI:', metadataURI);
  console.log('   - crop_id:', crop_id);
  console.log('   - walletAddress:', walletAddress);

  if (!metadataURI || !crop_id || !walletAddress) {
    console.log('⚠️ Neúplné údaje');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    console.log('⚠️ Neplatná adresa:', walletAddress);
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  const PROVIDER_URL = process.env.PROVIDER_URL;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const PRIVATE_KEY = process.env.PRIVATE_KEY?.replace(/^0x/, '');

  if (!PROVIDER_URL || !CONTRACT_ADDRESS || !PRIVATE_KEY) {
    console.log('❌ Chýbajú environment premenné');
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // Získanie nonce a gas ceny
    const nonce = await jsonRpcRequest('eth_getTransactionCount', [walletAddress, 'latest']);
    const gasPrice = await jsonRpcRequest('eth_gasPrice', []);
    
    console.log('⛽️ PLYN (Gas):');
    console.log('   - nonce:', nonce);
    console.log('   - gasPrice (wei):', gasPrice);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    const tx = {
      nonce: ethers.BigNumber.from(nonce),
      gasPrice: ethers.BigNumber.from(gasPrice),
      gasLimit: ethers.BigNumber.from(300000),  // Maximálny gas limit
      to: CONTRACT_ADDRESS,
      value: ethers.BigNumber.from(0),
      data: data,
      chainId: 111, // Sepolia testnet (môžeš nastaviť na iný chainId pre rôzne siete)
    };

    // Nastavíme providera a signera
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Podpisujeme transakciu
    const signedTx = await signer.signTransaction(tx);

    // Posielame transakciu na Infura
    const txHash = await jsonRpcRequest('eth_sendRawTransaction', [signedTx]);

    console.log('✅ Transakcia potvrdená:', txHash);

    return res.status(200).json({ success: true, txHash: txHash });
  } catch (err) {
    console.log('❌ [MINTCHAIN ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}