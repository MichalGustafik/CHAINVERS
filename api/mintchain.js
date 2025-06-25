module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // Overíme, že máme správnu BASE_URL
        const baseUrl = process.env.BASE_URL;
        if (!baseUrl) {
            log("❌ [MINTCHAIN] BASE_URL nie je nastavené.");
            return res.status(500).json({ error: "BASE_URL nie je nastavené" });
        }

        const mintchainUrl = `${baseUrl}/api/mintchain`;
        log("🔗 [API] Volanie na:", mintchainUrl);

        // Posielame požiadavku na Vercel API
        const response = await fetch(mintchainUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                metadataURI,
                crop_id,
                wallet
            }),
        });

        if (!response.ok) {
            const errorDetail = await response.text();
            log("❌ [API] Chyba pri volaní mintchain:", errorDetail);
            return res.status(500).json({ error: errorDetail });
        }

        const result = await response.json();
        log("✅ [API] Výsledok:", result);

        return res.status(200).json(result);
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};