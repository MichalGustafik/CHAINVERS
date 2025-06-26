import Web3 from 'web3';

// Iniciácia web3 providera
const providerUrl = process.env.PROVIDER_URL; // napr. https://sepolia.infura.io/v3/...
if (!providerUrl) throw new Error('Missing PROVIDER_URL env var');
const web3 = new Web3(providerUrl);

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);
function isValidAddress(addr) { return web3.utils.isAddress(addr); }

// Zakóduje volanie funkcie createOriginal(string,string,address)
function encodeFunctionCall(metadataURI, crop_id, walletAddress) {
  const abi = [{
    type: 'function',
    name: 'createOriginal',
    inputs: [
      { type:'string', name:'imageURI' },
      { type:'string', name:'cropId' },
      { type:'address', name:'to' }
    ]
  }];
  const contract = new web3.eth.Contract(abi);
  return contract.methods.createOriginal(metadataURI, crop_id, walletAddress).encodeABI();
}

export default async function handler(req, res) {
  log('===== MINTCHAIN request =====');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });
  const { metadataURI, crop_id, walletAddress } = req.body;
  log('Received:', metadataURI, crop_id, walletAddress);

  if (!metadataURI || !crop_id || !walletAddress) {
    log('⚠️ Missing params');
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }
  if (!isValidAddress(walletAddress)) {
    log('⚠️ Invalid wallet address');
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;

  if (!PRIVATE_KEY || !FROM || !TO) {
    log('❌ Missing environment variables');
    return res.status(500).json({ error: 'Missing env vars' });
  }
  if (!isValidAddress(FROM) || !isValidAddress(TO)) {
    log('❌ Invalid FROM or CONTRACT_ADDRESS');
    return res.status(500).json({ error: 'Invalid contract or from address' });
  }

  try {
    const nonce = await web3.eth.getTransactionCount(FROM);
    const gasPrice = await web3.eth.getGasPrice();
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    log('TX params:', { nonce, gasPrice, gasLimit });

    const tx = {
      from: FROM,
      to: TO,
      nonce: web3.utils.toHex(nonce),
      gasPrice: web3.utils.toHex(gasPrice),
      gas: web3.utils.toHex(gasLimit),
      value: '0x0',
      data
    };

    const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
    log('Signed:', signed.transactionHash);

    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
    log('Receipt:', receipt.transactionHash, receipt.blockNumber);

    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber
    });

  } catch (err) {
    log('❌ ERROR:', err.message || err);
    return res.status(500).json({ error: err.message || err.toString() });
  }
}