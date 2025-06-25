const fetch = require('node-fetch');  // Na volanie HTTP žiadostí
const { URLSearchParams } = require('url');

// Získaj environmentálne premenné z Vercel
const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;
const INFURA_PROJECT_SECRET = process.env.INFURA_PROJECT_SECRET;
const INFURA_RPC_URL = process.env.PROVIDER_URL; // Infura RPC URL (Base, Sepolia, Mainnet)
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;  // Adresa kontraktu
const GAS_LIMIT = 500000;  // Určte podľa potreby
const GAS_PRICE = 20000000000;  // Príklad gas price, nastavte podľa potreby

module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        log("📊 [ETHERS] Inicializácia providera...");

        // Príprava pre JSON RPC volanie
        const nonce = await getNonce();
        log("🔄 [ETHERS] Získaný nonce:", nonce);

        const tx = {
            to: CONTRACT_ADDRESS,
            data: buildData(metadataURI, crop_id, wallet), // Build transaction data pre volanie funkcie
            gasLimit: GAS_LIMIT,
            gasPrice: GAS_PRICE,
            nonce: nonce
        };

        // Pripravíme transakciu na podpisanie
        const signedTx = await signTransaction(tx);
        const txHash = await sendTransaction(signedTx);
        
        log("✅ [ETHERS] Transakcia odoslaná. Hash:", txHash);

        return res.status(200).json({ success: true, txHash: txHash });
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// Funkcia pre získanie nonce
async function getNonce() {
    const response = await fetch(INFURA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionCount",
            params: [PRIVATE_KEY, "latest"],
            id: 1
        })
    });

    const data = await response.json();
    return data.result;
}

// Funkcia na vybudovanie dát pre transakciu
function buildData(metadataURI, crop_id, wallet) {
    // Našou funkciou v smart kontrakte je createOriginal(metadataURI, crop_id, wallet)
    // Príklad: Volanie kontraktu s dátami v Hexa formáte
    const data = `0x${metadataURI}${crop_id}${wallet}`;
    return data;
}

// Funkcia na podpísanie transakcie (kľúč si uchovávajte v tajnosti)
async function signTransaction(tx) {
    // Rovnako ako predtým, použijeme INFURA RPC URL na podpísanie transakcie cez Private Key
    // Tento krok potrebuje správny algoritmus na podpísanie transakcie cez váš PRIVATE_KEY

    // Tu musíte implementovať signovanie (pre túto časť použijeme skôr knižnice alebo priamy prístup)
    return tx;
}

// Funkcia na odoslanie transakcie
async function sendTransaction(signedTx) {
    const response = await fetch(INFURA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_sendRawTransaction",
            params: [signedTx],
            id: 1
        })
    });

    const data = await response.json();
    return data.result;
}