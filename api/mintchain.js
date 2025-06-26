import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

function encodeFunctionCall(metadataURI, cropId, walletAddress) {
  const abi = [{
    type: 'function',
    name: 'createOriginal',
    inputs: [
      { type: 'string', name: 'imageURI' },
      { type: 'string', name: 'cropId' },
      { type: 'address', name: 'to' }
    ]
  }];
  const contract = new web3.eth.Contract(abi);
  return contract.methods.createOriginal(metadataURI, cropId, walletAddress).encodeABI();
}

function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

export default async function handler(req, res) {
  log('======= MINTCHAIN MINT STARTED =======');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { metadataURI, crop_id, walletAddress } = req.body;

  if (!metadataURI || !crop_id || !walletAddress) {
    return res.status(400).json({ error: 'Missing metadataURI, crop_id or walletAddress' });
  }

  if (!isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;

  if (!PRIVATE_KEY || !FROM || !TO || !process.env.PROVIDER_URL) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  if (!isValidAddress(FROM) || !isValidAddress(TO)) {
    return res.status(500).json({ error: 'Invalid FROM or CONTRACT_ADDRESS address' });
  }

  try {
    const nonce = await web3.eth.getTransactionCount(FROM);
    const gasPrice = await web3.eth.getGasPrice();
    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    const balance = await web3.eth.getBalance(FROM);
    const balanceBN = web3.utils.toBN(balance);

    log('⛽️ GAZ INFO:');
    log(`   nonce = ${nonce}`);
    log(`   gasPrice = ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    log(`   gasLimit = ${gasLimit}`);
    log(`   total cost = ${web3.utils.fromWei(gasCost.toString())} ETH`);
    log(`   balance = ${web3.utils.fromWei(balance)} ETH`);

    if (balanceBN.lt(gasCost)) {
      return res.status(400).json({
        error: 'Insufficient ETH for gas fees',
        requiredETH: web3.utils.fromWei(gasCost.toString()),
        walletBalance: web3.utils.fromWei(balance),
      });
    }

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
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    log('✅ TRANSACTION SENT:');
    log(`   txHash = ${receipt.transactionHash}`);
    log(`   blockNumber = ${receipt.blockNumber}`);

    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    });

  } catch (err) {
    log('❌ ERROR:', err.message || err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}