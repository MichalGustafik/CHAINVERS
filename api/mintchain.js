// api/mintchain.js
module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    // Kontrola HTTP metódy
    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        log("📥 [MINTCHAIN] Prijaté údaje:", {
            metadataURI,
            crop_id,
            wallet
        });

        // Overenie, že údaje sú správne
        if (!metadataURI || !crop_id || !wallet) {
            log("⚠️ [MINTCHAIN] Chýbajúce údaje:", { metadataURI, crop_id, wallet });
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        // Tu je vaša logika mintovania, spracovania obrázka, zápisu do blockchainu atď.
        // Ak už máte integráciu, môžete spracovať túto časť priamo tu.

        log("🚀 [MINTCHAIN] Proces mintovania prebieha...");
        
        // Tu môžete volať svoj smart kontrakt, pracovať s blockchainom a vyrobiť NFT
        // Za predpokladu, že použijete INFURA alebo priamo ETH klienta

        log("✅ [MINTCHAIN] Transakcia vytvorená úspešne!");

        // Odpovedzeme s úspešným výsledkom
        return res.status(200).json({
            success: true,
            message: "NFT bolo úspešne mintované.",
            txHash: "dummy_tx_hash" // Sem pridajte reálny transaction hash
        });
        
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ error: err.message });
    }
};