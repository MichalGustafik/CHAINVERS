import { mintNFT } from './mintchain'; // importujeme mintovací kód

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

        // Odoslanie obrázka a metadát na Pinata Cloud
        const metadataURI = await mintNFT({ crop_id, wallet, image_base64 });

        return res.status(200).json({
            success: true,
            message: "NFT vytvorený",
            metadataURI,
        });

    } catch (err) {
        log("❌ [VÝNIMKA]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}