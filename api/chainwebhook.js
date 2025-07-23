// /api/chainwebhook.js
import FormData from 'form-data';
import fetch from 'node-fetch';
import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const CONTRACT = process.env.CHAINVERS_CONTRACT; // nastav v .env na adresu tvojho ERC-721 kontraktu

async function waitForImageAvailability(imageUrl, maxAttempts = 5, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    const resp = await fetch(imageUrl, { method: 'HEAD' });
    if (resp.ok) return true;
    console.log(`⏳ Pokus ${i}/${maxAttempts} – obrázok ešte nie je dostupný.`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { crop_id, wallet, image_base64 } = req.body;
    if (!crop_id || !wallet || !image_base64) {
      return res.status(400).json({ error: "Chýbajú údaje" });
    }

    // 1) Pin image
    const buffer = Buffer.from(image_base64, "base64");
    const form = new FormData();
    form.append("file", buffer, `${crop_id}.png`);
    const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, ...form.getHeaders() },
      body: form
    });
    const imgJson = await imgRes.json();
    if (!imgJson.IpfsHash) {
      return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imgJson });
    }
    const imageURI = `https://ipfs.io/ipfs/${imgJson.IpfsHash}`;
    if (!(await waitForImageAvailability(imageURI))) {
      return res.status(500).json({ error: "Obrázok nie je dostupný cez IPFS gateway" });
    }

    // 2) Pin metadata
    const metadata = {
      name: `Chainvers NFT ${crop_id}`,
      description: `Originálny NFT z Chainvers, ktorý reprezentuje unikátny dizajn.`,
      image: imageURI,
      attributes: [
        { trait_type: "Crop ID", value: crop_id },
        { trait_type: "Category", value: "Art" },
        { trait_type: "Creator", value: "Chainvers Team" },
        { trait_type: "Edition", value: "Original" }
      ],
    };
    const metaRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        pinataMetadata: { name: `chainvers-metadata-${crop_id}` },
        pinataContent: metadata
      })
    });
    const metaJson = await metaRes.json();
    if (!metaJson.IpfsHash) {
      return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metaJson });
    }
    const metadataURI = `ipfs://${metaJson.IpfsHash}`;

    // 3) Mint
    const mintRes = await fetch(process.env.MINTCHAIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadataURI, crop_id, walletAddress: wallet })
    });
    const mintJson = await mintRes.json();
    if (!mintJson.success || !mintJson.txHash) {
      return res.status(500).json({ error: "Mintovanie zlyhalo", detail: mintJson });
    }

    // 4) Extract tokenId from receipt
    const receipt = await web3.eth.getTransactionReceipt(mintJson.txHash);
    const transferTopic = web3.utils.sha3("Transfer(address,address,uint256)");
    let tokenId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === CONTRACT.toLowerCase() && log.topics[0] === transferTopic) {
        tokenId = web3.utils.hexToNumber(log.topics[3]);
        break;
      }
    }
    if (tokenId === null) {
      return res.status(500).json({ error: "TokenId sa nenašiel v logoch" });
    }

    // 5) Build URLs
    const openseaUrl  = `https://opensea.io/assets/base/${CONTRACT}/${tokenId}`;
    const copyMintUrl = `https://chainvers.vercel.app/copy/${CONTRACT}/${tokenId}`;

    // 6) Return response
    return res.status(200).json({
      success: true,
      message: "NFT úspešne vytvorený",
      metadata_cid: metaJson.IpfsHash,
      txHash: mintJson.txHash,
      contractAddress: CONTRACT,
      tokenId,
      openseaUrl,
      copyMintUrl
    });

  } catch (err) {
    console.error("CHAINWEBHOOK ERROR:", err.stack);
    return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
  }
}