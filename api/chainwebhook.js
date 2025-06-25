import { ethers } from "ethers";

export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { crop_id, wallet, image_base64 } = req.body;
        log("📥 [VSTUP] Prijaté údaje:", {
            crop_id,
            wallet,
            image_base64_length: image_base64?.length || 0
        });

        if (!crop_id || !wallet || !image_base64) {
            log("⚠️ [VALIDÁCIA] Neúplné vstupné údaje.");
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        const buffer = Buffer.from(image_base64, "base64");

        // === 1. Upload obrázka na Pinatu ===
        log("📡 [PINATA] Nahrávanie obrázka...");
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
            log("❌ [PINATA] Obrázok sa nepodarilo nahrať.");
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
            log("❌ [PINATA] Nepodarilo sa nahrať metadáta.");
            return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
        }

        const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

        // === 3. Volanie kontraktu ===
        log("🚀 [ETHERS] Príprava volania kontraktu...");

        const rpcUrl = process.env.PROVIDER_URL;
        if (!rpcUrl) throw new Error("❌ PROVIDER_URL nie je nastavený!");

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            [
                "function createOriginal(string memory imageURI, string memory cropId, address to) public"
            ],
            signer
        );

        log("📤 [ETHERS] Odosielanie transakcie createOriginal...");
        const tx = await contract.createOriginal(metadataURI, crop_id, wallet);
        log("⏳ [ETHERS] Čakám na potvrdenie transakcie...");
        const receipt = await tx.wait();

        log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorený",
            metadata_cid: metadataResult.IpfsHash,
            txHash: receipt.transactionHash
        });

    } catch (err) {
        log("❌ [VÝNIMKA]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}