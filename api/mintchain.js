require('dotenv').config(); // Na načítanie environment variables
const fetch = require('node-fetch'); // Na HTTP požiadavky

module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    // Kontrola metódy požiadavky
    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // Kontrola vstupných údajov
        if (!metadataURI || !crop_id || !wallet) {
            log("⚠️ [VALIDÁCIA] Neúplné údaje:", { metadataURI, crop_id, wallet });
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        // Podrobné logy o prijatých údajoch
        log("📥 [MINTCHAIN] Prijaté údaje:", {
            metadataURI,
            crop_id,
            wallet
        });

        // URL, na ktorú presmerujeme požiadavku
        const targetURL = process.env.MINTCHAIN_API_URL; // Získať URL z environment variables

        // Vytvárame požiadavku na nový server alebo endpoint
        const response = await fetch(targetURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                metadataURI,
                crop_id,
                wallet
            })
        });

        const data = await response.json();

        log("✅ [MINTCHAIN] Odpoveď z presmerovaného servera:", data);

        if (response.ok) {
            return res.status(200).json({
                success: true,
                message: "Transaction sent successfully",
                result: data.result,
                metadata_cid: crop_id, // Zobrazenie crop_id ako CID
                txHash: data.txHash // Predpokladáme, že presmerovaný server vráti txHash
            });
        } else {
            return res.status(500).json({
                error: "Chyba pri presmerovaní požiadavky",
                details: data
            });
        }

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ error: err.message });
    }
};