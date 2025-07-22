import Web3 from 'web3';
import fetch from 'node-fetch';

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

function encodeFunctionCall(metadataURI) {
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

  // Pre oba URIs použijeme rovnaké metadataURI, publicURI zatiaľ necháme rovnaké
  return contract.methods
    .createOriginal(metadataURI, metadataURI, 0, 1000000)
    .encodeABI();
}

// ✅ Čaká, kým budú metadáta dostupné na ipfs.io gateway
async function waitForMetadataAvailability(ipfsUri, attempts = 5, delayMs = 3000) {
  const url = ipfsUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        log(`✅ Metadata dostupné po ${i} pokuse.`);
        return true;
      }
    } catch (e) {
      log(`⚠️ Pokus ${i}: metadata ešte nie sú dostupné.`);
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function getGasPrice() {
  try {
    const gasPrice = await web3.eth.getGasPrice();
    log(`⛽ Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} GWEI`);
    return gasPrice;
  } catch (err) {
    log('❌ Failed to get gas price:', err.message);
    throw err;
  }
}

export default async function handler(req, res) {
  log('===== MINTCHAIN START =====');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  const { metadataURI, crop_id, walletAddress } = req.body;

  if (!metadataURI || !metadataURI.startsWith('ipfs://')) {
    return res.status(400).json({ error: 'Invalid metadataURI. Should start with ipfs://' });
  }
  if (!crop_id || !walletAddress || !isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Missing or invalid crop_id/walletAddress' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;

  if (!PRIVATE_KEY || !FROM || !TO) {
    return res.status(500).json({ error: 'Missing env vars PRIVATE_KEY, FROM_ADDRESS or CONTRACT_ADDRESS' });
  }

  // 1) Čakanie na metadata dostupnosť
  log(`🔍 Checking metadata availability for ${metadataURI}`);
  const ok = await waitForMetadataAvailability(metadataURI);
  if (!ok) {
    return res.status(500).json({ error: 'Metadata not yet available on IPFS gateway' });
  }

  try {
    const chainId = await web3.eth.getChainId();
    const balance = await web3.eth.getBalance(FROM);
    log(`🔗 Chain ID: ${chainId}, balance: ${web3.utils.fromWei(balance)} ETH`);

    const gasPrice = await getGasPrice();
    const data = encodeFunctionCall(metadataURI);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    if (web3.utils.toBN(balance).lt(gasCost)) {
      return res.status(400).json({
        error: 'Insufficient ETH for gas',
        required: web3.utils.fromWei(gasCost),
        have: web3.utils.fromWei(balance)
      });
    }

    const tx = {
      from: FROM,
      to: TO,
      nonce: await web3.eth.getTransactionCount(FROM),
      gasPrice: web3.utils.toHex(gasPrice),
      gas: web3.utils.toHex(gasLimit),
      data,
    };

    const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    log(`✅ Mint successful: ${receipt.transactionHash}`);
    return res.status(200).json({ success: true, txHash: receipt.transactionHash });
  } catch (err) {
    log('❌ ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
