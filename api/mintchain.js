import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

function encodeCreateOriginalCall(privateURI, publicURI, royalty = 0, maxCopies = 1000000) {
  const funcAbi = {
    name: 'createOriginal',
    type: 'function',
    inputs: [
      { type: 'string', name: 'privateURI' },
      { type: 'string', name: 'publicURI' },
      { type: 'uint96', name: 'royaltyFeeNumerator' },
      { type: 'uint256', name: 'maxCopies' }
    ]
  };

  const signature = web3.eth.abi.encodeFunctionSignature(funcAbi);
  const params = web3.eth.abi.encodeParameters(
    ['string', 'string', 'uint96', 'uint256'],
    [privateURI, publicURI, royalty, maxCopies]
  );

  return signature + params.slice(2); // odstrániť "0x"
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
    log('🔗 Calling createOriginal with:');
    log('   imageURI:', metadataURI);
    log('   cropId:', crop_id);
    log('   walletAddress:', walletAddress);

    const chainId = await web3.eth.getChainId();
    const balance = await web3.eth.getBalance(FROM);
    const balanceEth = web3.utils.fromWei(balance, 'ether');
    log(`🔎 Chain ID: ${chainId}`);
    log(`💰 Wallet balance: ${balanceEth} ETH`);

    const gasPrice = await getGasPrice();
    const data = encodeCreateOriginalCall(metadataURI, metadataURI);
    log('📌 Encoded data:', data);

    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost =
