import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// ✅ Overenie adresy
function isValidAddress(addr) {
  return web3.utils.isAddress(addr);
}

// ✅ Encode funkcia s prázdnym publicURI
function encodeFunctionCall(privateURI) {
  const abi = {
    name: 'createOriginal',
    type: 'function',
    inputs: [
      { type: 'string', name: '_privateURI' },
      { type: 'string', name: '_publicURI' },
      { type: 'uint96', name: '_royalty' },
      { type: 'uint256', name: '_maxCopies' }
    ]
  };

  const encoded = web3.eth.abi.encodeFunctionCall(abi, [
    privateURI,   // ✅ privateURI (real data)
    "",           // ❌ publicURI = empty (won't show in wallets)
    '0',          // 0% royalty
    '1000000'     // maxCopies
  ]);

  log(`📌 createOriginal():\n   privateURI: ${privateURI}\n   publicURI: ""`);
  return encoded;
}

async function getGasPrice() {
  try {
    const gasPrice = await web3.eth.getGasPrice();
    log(`⛽ gasPrice: ${web3.utils.fromWei(gasPrice, 'gwei')} GWEI`);
    return gasPrice;
  } catch (err) {
    log('❌ Gas price error:', err.message);
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
    return res.status(400).json({ error: 'Invalid metadataURI' });
  }

  if (!crop_id || !walletAddress || !isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Missing or invalid parameters' });
  }

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const TO = process.env.CONTRACT_ADDRESS;
  const PROVIDER_URL = process.env.PROVIDER_URL;

  if (!PRIVATE_KEY || !FROM || !TO || !PROVIDER_URL) {
    return res.status(500).json({ error: 'Missing .env config' });
  }

  if (!isValidAddress(FROM) || !isValidAddress(TO)) {
    return res.status(500).json({ error: 'Invalid FROM or CONTRACT_ADDRESS' });
  }

  try {
    log('🧾 Mintovanie originálu...');
    log('   metadataURI:', metadataURI);
    log('   crop_id:', crop_id);
    log('   walletAddress:', walletAddress);

    const chainId = await web3.eth.getChainId();
    const balance = await web3.eth.getBalance(FROM);
    const balanceEth = web3.utils.fromWei(balance, 'ether');
    log(`🔎 chainId: ${chainId}`);
    log(`💰 balance: ${balanceEth} ETH`);

    const gasPrice = await getGasPrice();
    const data = encodeFunctionCall(metadataURI);
    const gasLimit = await web3.eth.estimateGas({ from: FROM, to: TO, data });

    const gasCost = web3.utils.toBN(gasPrice).mul(web3.utils.toBN(gasLimit));
    const balanceBN = web3.utils.toBN(balance);

    log(`📏 gasLimit: ${gasLimit}`);
    log(`💸 Estimated TX cost: ${web3.utils.fromWei(gasCost)} ETH`);

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

    log(`✅ Mint úspešný! TX hash: ${receipt.transactionHash}`);

    return res.status(200).json({
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber
    });

  } catch (err) {
    log('❌ ERROR:', err.message || err);
    return res.status(500).json({ error: err.message || 'Unexpected mintchain error' });
  }
}
