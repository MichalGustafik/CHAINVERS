import { ethers } from "ethers";
import fetch from "node-fetch";

export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { crop_id, wallet, image_base64 } = req.body;
        log("➡️ Prijaté údaje:", {
            crop_id,
            wallet,
            image_base64_length: image_base64?.length || 0
        });

        if (!crop_id || !wallet || !image_base64) {
            log("❌ Neúplné údaje");
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        const buffer = Buffer.from(image_base64, "base64");

        // === 1. Upload na Pinatu ===
        log("🔄 Nahrávanie obrázka na Pinatu...");
        const formData = new FormData();
        formData.append("file", new Blob([buffer]), `${crop_id}.png`);

        const imageUpload = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PINATA_JWT}`
            },
            body: formData
        });

        const imageResult = await imageUpload.json();
        log("🖼️ Výsledok obrázka:", imageResult);

        if (!imageResult.IpfsHash) {
            return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imageResult });
        }

        const imageURI = `ipfs://${imageResult.IpfsHash}`;

        // === 2. Metadata ===
        const metadata = {
            name: `Chainvers NFT ${crop_id}`,
            description: "NFT z CHAINVERS",
            image: imageURI,
            attributes: [{ trait_type: "Crop ID", value: crop_id }]
        };

        log("📦 Upload metadát...");
        const metadataUpload = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PINATA_JWT}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(metadata)
        });

        const metadataResult = await metadataUpload.json();
        log("📄 Výsledok metadát:", metadataResult);

        if (!metadataResult.IpfsHash) {
            return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
        }

        const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

        // === 3. Volanie smart kontraktu ===
        log("🚀 Volanie kontraktu...");
        const provider = new ethers.JsonRpcProvider(process.env.INFURA_URL);
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            [
                "function createOriginal(string memory imageURI, string memory cropId, address to) public"
            ],
            signer
        );

        const tx = await contract.createOriginal(metadataURI, crop_id, wallet);
        const receipt = await tx.wait();
        log("✅ Transakcia:", receipt.transactionHash);

        res.status(200).json({
            success: true,
            message: "NFT vytvorený",
            metadata_cid: metadataResult.IpfsHash,
            txHash: receipt.transactionHash
        });
    } catch (err) {
        log("❌ Chyba:", err.message);
        res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}