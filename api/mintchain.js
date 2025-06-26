import Web3 from 'web3';

// Funkcia na mintovanie NFT na adresu zákazníka cez Infura pomocou Web3.js
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
    // Nastavenie Web3 provider a účet
    const web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER_URL));
    const account = web3.eth.accounts.privateKeyToAccount('0x' + PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;

    // Získanie nonce a gas ceny
    const nonce = await web3.eth.getTransactionCount(account.address, 'latest');
    const gasPrice = await web3.eth.getGasPrice();

    log('⛽️ PLYN (Gas):');
    log('   - nonce:', nonce);
    log('   - gasPrice (wei):', gasPrice);

    const data = encodeFunctionCall(metadataURI, crop_id, walletAddress);

    const tx = {
      from: account.address,
      to: CONTRACT_ADDRESS,
      gas: 300000,  // Maximálny gas limit
      gasPrice: gasPrice,
      nonce: nonce,
      data: data,
      chainId: 84532, // Base Sepolia (testovacia sieť)
    };

    // Podpisovanie transakcie
    const signedTx = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);

    // Odoslanie podpísanej transakcie na Infura
    const txResponse = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    log('✅ [MINTCHAIN] Transakcia potvrdená:', txResponse.transactionHash);
    return res.status(200).json({ success: true, txHash: txResponse.transactionHash });
  } catch (err) {
    log('❌ [MINTCHAIN ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// pomocné funkcie
function encodeFunctionCall(uri, crop, to) {
  const methodID = '0x0f1320cb'; // Keccak256 funkcia "createOriginal(string,string,address)" => prvé 4 bajty

  const uriHex = web3.utils.utf8ToHex(uri).padEnd(66, '0'); // URI
  const cropHex = web3.utils.utf8ToHex(crop).padEnd(66, '0'); // Crop ID
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0'); // Adresa zákazníka

  return methodID + uriHex + cropHex + addr;
}