// CHAINVERS/api/chainwebhook.js

import { writeFile } from "fs/promises"; import { createRequire } from "module"; const require = createRequire(import.meta.url); const { ethers } = require("ethers");

const PROVIDER_URL = process.env.PROVIDER_URL; const PRIVATE_KEY = process.env.PRIVATE_KEY; const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS; const CONTRACT_ABI = require("../../abi.json"); const PINATA_JWT = process.env.PINATA_JWT;

export default async function handler(req, res) { if (req.method !== "POST") { return res.status(405).json({ error: "Method Not Allowed" }); }

try { const { crop_id, wallet, image_base64 } = req.body; console.log("[➡️ Prijaté údaje:", { crop_id, wallet, image_base64_length: image_base64.length, });

// === 1. Uloženie obrázka na disk (voliteľné logovanie/debug)
const imageBuffer = Buffer.from(image_base64, "base64");
const imageName = `${crop_id}.png`;
await writeFile(`/tmp/${imageName}`, imageBuffer);

// === 2. Upload na Pinata ===
console.log("[🔄 Nahrávanie obrázka na Pinatu...");
const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PINATA_JWT}`,
  },
  body: (() => {
    const form = new FormData();
    form.append("file", new Blob([imageBuffer]), imageName);
    return form;
  })(),
});
const imgData = await imgRes.json();
console.log("[🖼️ Výsledok obrázka:", imgData);

// === 3. Metadáta ===
console.log("[📦 Upload metadát...");
const metadata = {
  name: `CHAINVERS Crop #${crop_id}`,
  description: `NFT výrez pre ${wallet}`,
  image: `ipfs://${imgData.IpfsHash}`,
  crop_id: crop_id,
};

const metaRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${PINATA_JWT}`,
  },
  body: JSON.stringify({
    pinataMetadata: { name: `chainvers-metadata-${crop_id}` },
    pinataContent: metadata,
  }),
});
const metaDataRes = await metaRes.json();
console.log("[📄 Výsledok metadát:", metaDataRes);

// === 4. Kontrakt ===
console.log("[🚀 Volanie kontraktu...");
const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const walletSigner = new ethers.Wallet(PRIVATE_KEY, provider);

const balance = await provider.getBalance(walletSigner.address);
const balanceEth = ethers.formatEther(balance);
if (balance < ethers.parseEther("0.002")) {
  throw new Error(`❌ Nedostatočný zostatok: ${balanceEth} ETH`);
}

const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, walletSigner);
const tx = await contract.createOriginal(
  wallet,
  `ipfs://${metaDataRes.IpfsHash}`,
  crop_id
);

console.log("✅ Transakcia odoslaná:", tx.hash);
await tx.wait();
console.log("✅ Transakcia potvrdená:", tx.hash);

return res.status(200).json({ success: true, txHash: tx.hash });

} catch (err) { console.error("[❌ Chyba:", err); return res.status(500).json({ error: err.message || "Neznáma chyba" }); } }

