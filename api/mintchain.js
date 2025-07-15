import Web3 from 'web3';
import axios from 'axios';

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// ✅ Funkcia na kontrolu platnej adresy
function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

// ✅ Funkcia na zakódovanie volania smart kontraktu
function encodeFunctionCall(imageURI, cropId, walletAddress) {
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
  return contract.methods.createOriginal(imageURI, cropId, walletAddress).encodeABI();
}

// ✅ Voliteľné – Získanie gas price z Infura, fallback na Web3 ak nefunguje
async function getGasPrice() {
  try {
    const response = await axios.get(`https://gas.api.infura.io/v3/${process.env.INFURA_GAS_API}/gas-price`);
    if (response.data && response.data.gasPrice) {
      return response.data.gasPrice;
    }
    throw new Error('Failed to fetch gas price from Infura');
  } catch (err) {
    log('❌ Gas API Error:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  log('===== MINTCHAIN START =====');

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Only POST allowed' });

  const { imageURI, cropId, walletAddress } = req.body;

  // ✅ Log vstupných údajov
  log(`🔗 Calling createOriginal with:`);
  log(`   imageURI: ${imageURI}`);
  log(`   cropId: ${cropId}`);
  log(`   walletAddress: ${walletAddress}`);

  if (!imageURI || !cropId || !walletAddress || !isValidAddress(walletAddress)) {
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

    log(`🔎 Chain ID: ${chainId}`);
    log(`💰 Wallet balance: ${balanceEth} ETH`);

    // ✅ Získaj gasPrice – fallback ak zlyhá Infura
    const infuraGasPrice = await getGasPrice();
    const gasPrice = infuraGasPrice || await web3.eth.getGasPrice();

    const data = encodeFunctionCall(imageURI, cropId, walletAddress);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    const balanceBN = web3.utils.toBN(balance);

    log(`⛽ Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    log(`⛽ Gas limit: ${gasLimit}`);
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

    const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    log(`✅ Mint successful! TX: ${receipt.transactionHash}`);
    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber
    });

  } catch (err) {
    log('❌ ERROR:', err.message || err);
    return res.status(500).json({ error: err.message || 'Unexpected.' });
  }
}
