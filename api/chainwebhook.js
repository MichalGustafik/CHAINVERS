// /api/chainwebhook.js
import FormData from 'form-data';
import fetch from 'node-fetch';
import Web3 from 'web3';

const web3 = new Web3(process.env.PROVIDER_URL);
const CONTRACT = process.env.CHAINVERS_CONTRACT; // nastav v .env

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

  const { crop_id, wallet, image_base64 } = req.body;
  if (!crop_id || !wallet || !image_base64) {
    return res.status(400).json({ error: "Chýbajú údaje" });
  }

  // 1) Pin image
  const buffer = Buffer.from(image_base64, "base64");
  const formData = new FormData();
  formData.append("file", buffer, `${crop_id}.png`);
  const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PINATA_JWT}`, ...formData.getHeaders() },
    body: formData,
  });
  const imgJson = await imgRes.json();
  if (!imgJson.IpfsHash) {
    return res.status(500).json({ error: "Pin image failed", detail: imgJson });
  }
  const imageURI = `https://ipfs.io/ipfs/${imgJson.IpfsHash}`;
  const ok = await waitForImageAvailability(imageURI);
  if (!ok) {
    return res.status(500).json({ error: "Image not available" });
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
    }),
  });
  const metaJson = await metaRes.json();
  if (!metaJson.IpfsHash) {
    return res.status(500).json({ error: "Pin metadata failed", detail: metaJson });
  }
  const metadataURI = `ipfs://${metaJson.IpfsHash}`;

  // 3) Mint
  const mintCall = await fetch(process.env.MINTCHAIN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadataURI, crop_id, walletAddress: wallet }),
  });
  const mintResult = await mintCall.json();
  if (!mintResult.success || !mintResult.txHash) {
    return res.status(500).json({ error: "Mint failed", detail: mintResult });
  }

  // 4) Získame receipt a extract tokenId
  const receipt = await web3.eth.getTransactionReceipt(mintResult.txHash);
  const transferSig = web3.utils.sha3("Transfer(address,address,uint256)");
  let tokenId = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === CONTRACT.toLowerCase() && log.topics[0] === transferSig) {
      // topics[3] = tokenId
      tokenId = web3.utils.hexToNumber(log.topics[3]);
      break;
    }
  }
  if (tokenId === null) {
    return res.status(500).json({ error: "TokenId not found in logs" });
  }

  // 5) Sestavíme odkazy
  const openseaUrl  = `https://opensea.io/assets/base/${CONTRACT}/${tokenId}`;
  const copyMintUrl = `https://chainvers.vercel.app/copy/${CONTRACT}/${tokenId}`;

  // 6) Vrátime všetko potrebné
  return res.status(200).json({
    success: true,
    message: "NFT úspešne vytvorený",
    metadata_cid: metaJson.IpfsHash,
    txHash: mintResult.txHash,
    contractAddress: CONTRACT,
    tokenId,
    openseaUrl,
    copyMintUrl
  });
}