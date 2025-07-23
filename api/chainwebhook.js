// /api/chainwebhook.js
import FormData from 'form-data';
import fetch from 'node-fetch';

async function waitForImageAvailability(imageUrl, maxAttempts = 5, delayMs = 3000) {
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
const response = await fetch(imageUrl, { method: 'HEAD' });
if (response.ok) return true;
console.log([${new Date().toISOString()}] ⏳ Pokus ${attempt}/${maxAttempts} – obrázok ešte nie je dostupný.);
await new Promise((resolve) => setTimeout(resolve, delayMs));
}
return false;
}

export default async function handler(req, res) {
const log = (...args) => console.log([${new Date().toISOString()}], ...args);

if (req.method !== 'POST') {
log("❌ Nepodporovaná HTTP metóda:", req.method);
return res.status(405).json({ error: "Method Not Allowed" });
}

try {
const { crop_id, wallet, image_base64 } = req.body;
log("📥 Vstup:", { crop_id, wallet, image_base64_length: image_base64?.length || 0 });

if (!crop_id || !wallet || !image_base64) {  
  return res.status(400).json({ error: "Chýbajú údaje" });  
}  

const buffer = Buffer.from(image_base64, "base64");  

const formData = new FormData();  
formData.append("file", buffer, `${crop_id}.png`);  

const imageUpload = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {  
  method: "POST",  
  headers: {  
    Authorization: `Bearer ${process.env.PINATA_JWT}`,  
    ...formData.getHeaders()  
  },  
  body: formData,  
});  

const imageResult = await imageUpload.json();  
if (!imageResult.IpfsHash) {  
  return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imageResult });  
}  

const imageURI = `https://ipfs.io/ipfs/${imageResult.IpfsHash}`;  
const dostupne = await waitForImageAvailability(imageURI);  
if (!dostupne) {  
  return res.status(500).json({ error: "Obrázok nie je dostupný cez IPFS gateway" });  
}  

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

const metadataUpload = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {  
  method: "POST",  
  headers: {  
    Authorization: `Bearer ${process.env.PINATA_JWT}`,  
    "Content-Type": "application/json"  
  },  
  body: JSON.stringify({  
    pinataMetadata: {  
      name: `chainvers-metadata-${crop_id}`  
    },  
    pinataContent: metadata  
  }),  
});  

const metadataResult = await metadataUpload.json();  
if (!metadataResult.IpfsHash) {  
  return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });  
}  

const metadataURI = `ipfs://${metadataResult.IpfsHash}`;  

const mintCall = await fetch(process.env.MINTCHAIN_API_URL, {  
  method: "POST",  
  headers: { "Content-Type": "application/json" },  
  body: JSON.stringify({  
    metadataURI,  
    crop_id,  
    walletAddress: wallet  
  }),  
});  

const mintResult = await mintCall.json();  
if (!mintResult.success) {  
  return res.status(500).json({ error: "Mintovanie zlyhalo", detail: mintResult });  
}  

const contractAddress = process.env.CONTRACT_ADDRESS;  
const tokenId = mintResult.tokenId || crop_id; // alebo získané z mintResult  
const openseaUrl = `https://opensea.io/assets/base/${contractAddress}/${tokenId}`;  
const copyMintUrl = `https://chainvers.vercel.app/copy/${contractAddress}/${tokenId}`;  

return res.status(200).json({  
  success: true,  
  message: "NFT úspešne vytvorený",  
  metadata_cid: metadataResult.IpfsHash,  
  txHash: mintResult.txHash,  
  contractAddress,  
  tokenId,  
  openseaUrl,  
  copyMintUrl  
});

} catch (err) {
return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
}
}

