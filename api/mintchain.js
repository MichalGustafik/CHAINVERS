const fetch = require('node-fetch');

export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        if (!process.env.PROVIDER_URL) {
            log("❌ [MINTCHAIN] Chýbajú environmentálne premenné.");
            return res.status(500).json({ error: "Chýbajú environmentálne premenné." });
        }

        // Vytvorenie RPC URL (INFURA_URL)
        const rpcUrl = process.env.PROVIDER_URL;
        const privateKey = process.env.PRIVATE_KEY;  // Získajte privátny kľúč

        log("📊 [INFURA] Inicializácia providera...");

        const provider = new fetch(rpcUrl, { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.INFURA_KEY}`  // Ak používate Infura key
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                    {
                        to: process.env.CONTRACT_ADDRESS,  // Adresa vášho smart kontraktu
                        data: `0x${metadataURI}`  // Dáta pre vaše NFT, generované pomocou IPFS
                    }
                ]
            })
        });

        const response = await provider.json();
        log("📈 [INFURA] Odpoveď z Infura:", response);

        if (!response.result) {
            return res.status(500).json({ error: "Chyba pri volaní Infura", detail: response });
        }

        log("✅ [MINTCHAIN] Úspešné volanie kontraktu.");

        // Vrátenie odpovede so spracovaním údajov.
        return res.status(200).json({ success: true, message: "NFT vytvorené", metadataURI });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}