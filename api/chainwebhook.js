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
        
        // === 3. Volanie mintchain ===
        log("🚀 [CHAIN] Volanie mintchain...");
        
        // Zavoláme mintchain.js priamo
        const mintResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/mintchain`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ metadataURI, crop_id, wallet })
        });
        
        const mintResult = await mintResponse.json();
        
        if (!mintResult.success) {
            log("❌ [CHAIN] Mint zlyhal:", mintResult);
            return res.status(500).json({ error: "Mintovanie zlyhalo", detail: mintResult });
        }
        
        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            metadata_cid: metadataResult.IpfsHash,
            txHash: mintResult.txHash
        });
        
    } catch (err) {
        log("❌ [VÝNIMKA]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}