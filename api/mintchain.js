require('dotenv').config(); // Na načítanie environment variables
const fetch = require('node-fetch'); // Na HTTP požiadavky
const Web3 = require('web3'); // Na enkódovanie dát pre Ethereum RPC

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

        // Infura RPC endpoint
        const url = process.env.PROVIDER_URL; // Infura URL z environment variables
        if (!url) {
            log("❌ [MINTCHAIN] Infura URL nie je nastavené.");
            return res.status(500).json({ error: "Nastavenie Infura URL je neúplné" });
        }

        // Smart kontrakt data
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const method = "createOriginal"; // Názov metódy kontraktu
        const params = [metadataURI, crop_id, wallet]; // Parametre metódy

        // Vytvorenie JSON-RPC požiadavky pre Infura
        const jsonRpcPayload = {
            jsonrpc: "2.0",
            method: "eth_call", // Pre volanie kontraktu
            params: [{
                to: contractAddress,
                data: encodeFunctionCall(method, params) // Zakódovanie volania funkcie
            }, "latest"],
            id: 1
        };

        log("📡 [INFURA] Vytváram požiadavku na Infura:", jsonRpcPayload);

        // Vykonanie HTTP POST požiadavky na Infura
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.INFURA_API_KEY}` // Ak máte Infura API key
            },
            body: JSON.stringify(jsonRpcPayload)
        });

        const data = await response.json();
        log("✅ [INFURA] Odpoveď z Infura:", data);

        if (data.error) {
            log("❌ [INFURA] Chyba v odpovedi z Infura:", data.error);
            return res.status(500).json({ error: "Infura API error", details: data.error });
        }

        // Návrat úspechu
        return res.status(200).json({
            success: true,
            message: "Transaction sent successfully",
            result: data.result,
            metadata_cid: crop_id, // Zobrazenie crop_id ako CID
            txHash: data.result // Predpokladáme, že Infura vráti transaction hash
        });
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ error: err.message });
    }
};

// Funkcia na zakódovanie volania kontraktu
function encodeFunctionCall(functionName, params) {
    const web3 = new Web3(); // Vytvárame inštanciu Web3 pre enkódovanie
    const methodId = web3.utils.sha3(functionName).slice(0, 10); // Získa prvých 4 bajty (metóda)
    const encodedParams = params.map(param => web3.eth.abi.encodeParameter('string', param)).join('');
    return methodId + encodedParams;
}