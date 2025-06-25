import { v4 as uuidv4 } from "uuid";

// Funkcia na zobrazenie logov s timestampom
const log = (message, ...args) => {
    const now = new Date().toISOString();
    console.log(`[${now}]`, message, ...args);
};

export default async function handler(req, res) {
    if (req.method !== "POST") {
        log("❌ [CHAINWEBHOOK] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { crop_id, wallet, image_base64 } = req.body;

        // Overenie prítomnosti povinných údajov
        if (!crop_id || !wallet || !image_base64) {
            log("⚠️ [CHAINWEBHOOK] Neúplné údaje:", req.body);
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        log("📥 [CHAINWEBHOOK] Prijaté údaje:", { crop_id, wallet, image_base64_length: image_base64.length });

        // === 1. Upload obrázka na Pinata ===
        log("📡 [PINATA] Nahrávanie obrázka...");
        const buffer = Buffer.from(image_base64, "base64");

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
        log("🖼️ [PINATA] Výsledok obrázka:", imageResult);

        if (!imageResult.IpfsHash) {
            log("❌ [PINATA] Obrázok sa nepodarilo nahrať.", imageResult);
            return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imageResult });
        }

        const imageURI = `ipfs://${imageResult.IpfsHash}`;

        // === 2. Upload metadát ===
        const metadata = {
            name: `Chainvers NFT ${crop_id}`,
            description: "NFT z CHAINVERS",
            image: imageURI,
            attributes: [{ trait_type: "Crop ID", value: crop_id }]
        };

        log("📦 [PINATA] Nahrávanie metadát...");
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
            })
        });

        const metadataResult = await metadataUpload.json();
        log("📄 [PINATA] Výsledok metadát:", metadataResult);

        if (!metadataResult.IpfsHash) {
            log("❌ [PINATA] Nepodarilo sa nahrať metadáta.", metadataResult);
            return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
        }

        const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

        // === 3. Volanie mintchain.js (presmerovanie na správnu URL) ===
        log("🚀 [CHAINWEBHOOK] Príprava na volanie mintchain.js...");

        // Získame URL podľa BASE_URL (musí byť nastavená vo Vercel environment variables)
        const mintchainURL = process.env.BASE_URL ? `${process.env.BASE_URL}/api/mintchain` : `http://localhost:3000/api/mintchain`;

        log("🔗 [CHAINWEBHOOK] Volanie na URL:", mintchainURL);

        // Volanie API na mintchain.js
        const mintResponse = await fetch(mintchainURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                metadataURI,
                crop_id,
                wallet
            })
        });

        const mintResult = await mintResponse.json();
        log("📤 [CHAINWEBHOOK] Výsledok mintchain.js:", mintResult);

        if (!mintResult.success) {
            log("❌ [CHAINWEBHOOK] Chyba pri mintovaní NFT:", mintResult);
            return res.status(500).json({ error: "Chyba pri mintovaní NFT", detail: mintResult });
        }

        log("✅ [CHAINWEBHOOK] NFT úspešne vytvorené, transakcia:", mintResult.txHash);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            txHash: mintResult.txHash
        });

    } catch (err) {
        log("❌ [CHAINWEBHOOK ERROR]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}