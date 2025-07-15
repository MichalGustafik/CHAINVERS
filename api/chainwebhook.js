// ✅ chainwebhook.js
import FormData from 'form-data';
import fetch from 'node-fetch';
import { Readable } from 'stream';

export default async function handler(req, res) {
  const now = new Date().toISOString();
  const log = (...args) => console.log(`[${now}]`, ...args);

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { crop_id, wallet, image_base64 } = req.body;
  log('📥 VSTUP:', { crop_id, wallet, image_base64_length: image_base64?.length });

  const buffer = Buffer.from(image_base64, 'base64');
  log('📡 Pripravujem stream z bufferu...');
  const stream = Readable.from(buffer);

  const formData = new FormData();
  formData.append('file', stream, { filename: `${crop_id}.png`, contentType: 'image/png' });

  const imageUpload = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, ...formData.getHeaders() },
    body: formData,
  });

  const imageResult = await imageUpload.json();
  log('🖼️ Pinata obrázok:', imageResult);
  if (!imageResult.IpfsHash) return res.status(500).json({ error: 'Nepodarilo sa nahrať obrázok', detail: imageResult });

  const imageURI = `ipfs://${imageResult.IpfsHash}`;
  const metadata = { name: `Chainvers NFT ${crop_id}`, description: 'NFT z CHAINVERS', image: imageURI, attributes: [{ trait_type: 'Crop ID', value: crop_id }] };

  const metadataUpload = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataMetadata: { name: `chainvers-metadata-${crop_id}` }, pinataContent: metadata }),
  });

  const metadataResult = await metadataUpload.json();
  log('📄 Pinata metadáta:', metadataResult);
  if (!metadataResult.IpfsHash) return res.status(500).json({ error: 'Nepodarilo sa nahrať metadáta', detail: metadataResult });

  const metadataURI = `ipfs://${metadataResult.IpfsHash}`;
  const mintCall = await fetch(process.env.MINTCHAIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadataURI, crop_id, walletAddress: wallet }),
  });

  const mintResult = await mintCall.json();
  log('🚀 Mint result:', mintResult);
  if (!mintResult.success) return res.status(500).json({ error: 'Mint zlyhal', detail: mintResult });

  return res.status(200).json({ success: true, metadata_cid: metadataResult.IpfsHash, txHash: mintResult.txHash });
}


// ✅ mintchain.js
import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

function encodeFunctionCall(metadataURI, cropId, walletAddress) {
  const abi = [{
    type: 'function',
    name: 'createOriginal',
    inputs: [
      { type: 'string', name: 'privateURI' },
      { type: 'string', name: 'publicURI' },
      { type: 'uint96', name: 'royaltyFeeNumerator' },
      { type: 'uint256', name: 'maxCopies' }
    ]
  }];
  const contract = new web3.eth.Contract(abi);
  log(`📎 metadataURI to send in contract: ${metadataURI}`);
  return contract.methods.createOriginal(metadataURI, metadataURI, 0, 1000000).encodeABI();
}

async function getGasPrice() {
  try {
    const gasPrice = await web3.eth.getGasPrice();
    log(`⛽ Gas price (from provider): ${web3.utils.fromWei(gasPrice, 'gwei')} GWEI`);
    return gasPrice;
  } catch (err) {
    log('❌ Failed to get gas price:', err.message);
    throw new Error('Unable to fetch gas price');
  }
}

export default async function handler(req, res) {
  log('===== MINTCHAIN START =====');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  if (!metadataURI || (!metadataURI.startsWith('ipfs://') && !metadataURI.startsWith('https://'))) {
    return res.status(400).json({ error: 'Invalid metadataURI. Should be an IPFS URI.' });
  }

  if (!crop_id || !walletAddress || !isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Missing or invalid parameters' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;

  if (!PRIVATE_KEY || !FROM || !TO || !process.env.PROVIDER_URL) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  if (!isValidAddress(FROM) || !isValidAddress(TO)) {
    return res.status(500).json({ error: 'Invalid FROM or CONTRACT_ADDRESS' });
  }

  try {
    const chainId = await web3.eth.getChainId();
    const balance = await web3.eth.getBalance(FROM);
    const balanceEth = web3.utils.fromWei(balance, 'ether');
    log(`🔗 Chain ID: ${chainId}`);
    log(`💰 Wallet balance: ${balanceEth} ETH`);

    const gasPrice = await getGasPrice();
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    const balanceBN = web3.utils.toBN(balance);

    log(`📏 gasLimit: ${gasLimit}`);
    log(`💵 Estimated TX cost: ${web3.utils.fromWei(gasCost)} ETH`);

    if (balanceBN.lt(gasCost)) {
      return res.status(400).json({
        error: 'Insufficient ETH for gas fees',
        requiredETH: web3.utils.fromWei(gasCost),
        walletBalance: balanceEth,
      });
    }

    const tx = {
      from: FROM,
      to: TO,
      nonce: await web3.eth.getTransactionCount(FROM),
      gasPrice: web3.utils.toHex(gasPrice),
      gas: web3.utils.toHex(gasLimit),
      value: '0x0',
      data
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    log(`✅ Mint successful! TX: ${receipt.transactionHash}`);
    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber
    });

  } catch (err) {
    log('❌ ERROR:', err.message || err);
    return res.status(500).json({ error: err.message || 'Unexpected error occurred.' });
  }
}
