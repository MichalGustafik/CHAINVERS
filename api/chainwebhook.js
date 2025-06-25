import { writeFileSync } from "fs";
import path from "path";
import { ethers } from "ethers";

const pinataApi = "https://api.pinata.cloud/pinning/";
const JWT = process.env.PINATA_JWT;
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CONTRACT_ABI = [ // zjednodušený ABI, doplň skutočný podľa potreby
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "string", "name": "tokenURI", "type": "string" },
      { "internalType": "string", "name": "cropId", "type": "string" }
    ],
    "name": "createOriginal",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { crop_id, wallet, image_base64 } = req.body;
    console.log("➡️ Prijaté údaje:", {
      crop_id,
      wallet,
      image_base64_length: image_base64?.length,
    });

    if (!crop_id || !wallet || !image_base64) {
      return res.status(400).json({ error: "Chýbajúce dáta" });
    }

    // 🔄 1. Upload obrázka na Pinata
    console.log("🔄 Nahrávanie obrázka na Pinatu...");
    const imageResponse = await fetch(`${pinataApi}pinFileToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JWT}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file: image_base64,
        options: {
          cidVersion: 1,
          metadata: {
            name: `${crop_id}.png`
          }
        }
      })
    });
    const imageData = await imageResponse.json();
    console.log("🖼️ Výsledok obrázka:", imageData);

    const imageCID = imageData.IpfsHash;

    // 📦 2. Upload metadát
    console.log("📦 Upload metadát...");
    const metadata = {
      name: `CHAINVERS NFT ${crop_id}`,
      description: "CHAINVERS: Vesmírny výrez transformovaný do NFT",
      image: `ipfs://${imageCID}`,
      attributes: [{ trait_type: "Crop ID", value: crop_id }]
    };

    const metadataResponse = await fetch(`${pinataApi}pinJSONToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JWT}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pinataMetadata: {
          name: `chainvers-metadata-${crop_id}`
        },
        pinataContent: metadata
      })
    });

    const metadataData = await metadataResponse.json();
    console.log("📄 Výsledok metadát:", metadataData);

    const metadataCID = metadataData.IpfsHash;

    // 🚀 3. Volanie kontraktu
    console.log("🚀 Volanie kontraktu...");
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const walletSigner = new ethers.Wallet(PRIVATE_KEY, provider);
    const balance = await provider.getBalance(walletSigner.address);

    if (balance < ethers.parseEther("0.002")) {
      throw new Error(
        `❌ Nedostatočný zostatok: ${ethers.formatEther(balance)} ETH`
      );
    }

    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, walletSigner);
    const tx = await contract.createOriginal(
      wallet,
      `ipfs://${metadataCID}`,
      crop_id
    );
    await tx.wait();

    console.log(`✅ Transakcia dokončená: ${tx.hash}`);
    res.status(200).json({ success: true, tx: tx.hash });
  } catch (error) {
    console.error("❌ Chyba:", error);
    res.status(500).json({ error: error.message || "Neznáma chyba" });
  }
}