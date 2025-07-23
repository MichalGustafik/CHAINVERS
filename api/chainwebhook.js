// /api/chainwebhook.js
import FormData from 'form-data';
import fetch from 'node-fetch';
import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const CONTRACT = process.env.CONTRACT_ADDRESS; // ← používame správne meno

// Minimal ABI len pre tokenIdCounter()
const CONTRACT_ABI = [
  { constant: true, inputs: [], name: 'tokenIdCounter', outputs: [{ name: '', type: 'uint256' }], type: 'function' }
];
const contract = new web3.eth.Contract(CONTRACT_ABI);
if (CONTRACT) {
  contract.options.address = CONTRACT;
}

async function waitForImageAvailability(imageUrl, maxAttempts = 5, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const resp = await fetch(imageUrl, { method: 'HEAD' });
    if (resp.ok) return true;
    console.log(`⏳ Pokus ${i}/${maxAttempts} – obrázok ešte nie je dostupný.`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function getReceipt(txHash, maxTries = 10, delayMs = 3000) {
  for (let i = 0; i < maxTries; i++) {
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (receipt) return receipt;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { crop_id, wallet, image_base64 } = req.body;
    if (!crop_id || !wallet || !image_base64) {
      return res.status(400).json({ error: 'Chýbajú údaje' });
    }

    // 1) Upload image
    const buf = Buffer.from(image_base64, 'base64');
    const form = new FormData();
    form.append('file', buf, `${crop_id}.png`);
    const imgRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, ...form.getHeaders() },
      body: form
    });
    const imgJson = await imgRes.json();
    if (!imgJson.IpfsHash) {
      return res.status(500).json({ error: 'Nepodarilo sa nahrať obrázok', detail: imgJson });
    }
    const imageURI = `https://ipfs.io/ipfs/${imgJson.IpfsHash}`;
    if (!(await waitForImageAvailability(imageURI))) {
      return res.status(500).json({ error: 'Obrázok nie je dostupný cez IPFS gateway' });
    }

    // 2) Upload metadata
    const metadata = {
      name: `Chainvers NFT ${crop_id}`,
      description: `Originálny NFT z Chainvers, ktorý reprezentuje unikátny dizajn.`,
      image: imageURI,
      attributes: [
        { trait_type: 'Crop ID', value: crop_id },
        { trait_type: 'Category', value: 'Art' },
        { trait_type: 'Creator', value: 'Chainvers Team' },
        { trait_type: 'Edition', value: 'Original' }
      ]
    };
    const metaRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pinataMetadata: { name: `chainvers-metadata-${crop_id}` },
        pinataContent: metadata
      })
    });
    const metaJson = await metaRes.json();
    if (!metaJson.IpfsHash) {
      return res.status(500).json({ error: 'Nepodarilo sa nahrať metadáta', detail: metaJson });
    }
    const metadataURI = `ipfs://${metaJson.IpfsHash}`;

    // 3) Mint NFT
    const mintRes = await fetch(process.env.MINTCHAIN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadataURI, crop_id, walletAddress: wallet })
    });
    const mintJson = await mintRes.json();
    if (!mintJson.success || !mintJson.txHash) {
      return res.status(500).json({ error: 'Mintovanie zlyhalo', detail: mintJson });
    }

    // 4) Get transaction receipt
    const receipt = await getReceipt(mintJson.txHash);
    if (!receipt) {
      return res.status(500).json({ error: 'Transakcia nebola potvrdená' });
    }

    // 5) Extract tokenId from logs
    const transferTopic = web3.utils.keccak256('Transfer(address,address,uint256)');
    let tokenId = null;
    for (const lg of receipt.logs || []) {
      if (lg.topics && lg.topics[0] === transferTopic && lg.topics.length >= 4) {
        try {
          tokenId = web3.utils.hexToNumber(lg.topics[3]);
          break;
        } catch (_) {}
      }
    }

    // 6) Fallback ak sa tokenId nepodarí z logov
    if (tokenId === null && contract.options.address) {
      const counter = await contract.methods.tokenIdCounter().call();
      tokenId = parseInt(counter, 10) - 1;
    }

    // 7) Build response
    const openseaUrl  = `https://opensea.io/assets/base/${CONTRACT}/${tokenId || crop_id}`;
    const copyMintUrl = `https://chainvers.vercel.app/copy/${CONTRACT}/${tokenId || crop_id}`;

    return res.status(200).json({
      success: true,
      message: 'NFT úspešne vytvorený',
      metadata_cid: metaJson.IpfsHash,
      txHash: mintJson.txHash,
      contractAddress: CONTRACT,
      tokenId: tokenId || crop_id,
      cropId: crop_id,
      openseaUrl,
      copyMintUrl
    });

  } catch (err) {
    console.error('CHAINWEBHOOK ERROR:', err.stack);
    return res.status(500).json({ error: 'Interná chyba servera', detail: err.message });
  }
}
