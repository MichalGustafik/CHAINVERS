const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // === Inicializácia providera cez Infura ===
        log("📊 [INFURA] Inicializácia providera...");

        const providerUrl = process.env.PROVIDER_URL; // Infura URL
        const privateKey = process.env.PRIVATE_KEY;
        const contractAddress = process.env.CONTRACT_ADDRESS;

        // === Získanie zostatku peňaženky ===
        const balanceData = {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBalance",
            params: [wallet, "latest"]
        };

        const balanceResponse = await fetch(providerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(balanceData)
        });
        const balanceResult = await balanceResponse.json();
        const balance = parseInt(balanceResult.result, 16); // Previesť hex na číslo
        log("💰 [BALANCE] Peňaženka má:", balance / 1e18, "ETH");

        if (balance <= 100000000000000) { // Ak je zostatok menší než 0.0001 ETH
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // === Príprava transakcie ===
        const gasPriceResponse = await fetch(providerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "eth_gasPrice",
                params: []
            })
        });
        const gasPriceResult = await gasPriceResponse.json();
        const gasPrice = gasPriceResult.result;

        const txData = {
            jsonrpc: "2.0",
            id: 3,
            method: "eth_sendTransaction",
            params: [{
                from: wallet,
                to: contractAddress,
                gas: "0x5208", // Gas limit
                gasPrice: gasPrice,
                data: `0x${metadataURI}${crop_id}${wallet}`, // Prispôsobte podľa požiadaviek kontraktu
            }]
        };

        // === Odoslanie transakcie ===
        const txResponse = await fetch(providerUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(txData)
        });

        const txResult = await txResponse.json();
        log("📤 [INFURA] Odoslaná transakcia:", txResult.result);

        if (txResult.error) {
            log("❌ [INFURA] Chyba transakcie:", txResult.error.message);
            return res.status(500).json({ error: txResult.error.message });
        }

        return res.status(200).json({
            success: true,
            txHash: txResult.result
        });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};