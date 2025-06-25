export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        // Extrahovanie parametrov z požiadavky
        const { metadataURI, walletAddress } = req.body;

        if (!metadataURI || !walletAddress) {
            log("⚠️ [MINTCHAIN] Chýbajú parametre metadataURI alebo walletAddress.");
            return res.status(400).json({ error: "Missing required parameters" });
        }

        // Infura API URL pre Sepolia alebo iné Ethereum testovacie siete
        const providerUrl = `https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`;
        const privateKey = process.env.PRIVATE_KEY;
        const contractAddress = process.env.CONTRACT_ADDRESS;

        if (!providerUrl || !privateKey || !contractAddress) {
            log("⚠️ [MINTCHAIN] Chýbajú environment variables.");
            return res.status(400).json({ error: "Missing environment variables" });
        }

        log("📊 [INFURA] Inicializácia providera...");

        // Vytvorenie transakcie pomocou HTTP POST
        const nonce = await getNonce(providerUrl, privateKey);
        const gasPrice = await getGasPrice(providerUrl);

        const data = {
            to: contractAddress,
            gasLimit: "0x100000", // Prispôsob si podľa potreby
            gasPrice: gasPrice,
            nonce: nonce,
            data: `0x` + encodeMintFunction(metadataURI, walletAddress)
        };

        const tx = await sendTransaction(providerUrl, privateKey, data);
        log("📊 [TRANSAKCE] Transakcia odoslaná:", tx);

        return res.status(200).json({ success: true, txHash: tx.transactionHash });
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// Získať nonce (číslovanie transakcií peňaženky)
async function getNonce(providerUrl, privateKey) {
    const response = await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionCount",
            params: [privateKey, "latest"],
            id: 1
        })
    });
    const data = await response.json();
    return data.result;
}

// Získať aktuálnu cenu gas
async function getGasPrice(providerUrl) {
    const response = await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_gasPrice",
            params: [],
            id: 1
        })
    });
    const data = await response.json();
    return data.result;
}

// Kód pre zakódovanie funkcie mintovania (pre `createOriginal` funkciu v smart kontrakte)
function encodeMintFunction(metadataURI, walletAddress) {
    const functionSignature = "createOriginal(string,string,address)"; // Názov funkcie a jej typy
    const data = web3.utils.soliditySha3(functionSignature).substring(2);
    return data + metadataURI.slice(2) + walletAddress.slice(2); // Prispôsob správne formátovanie parametrov
}

// Posielanie transakcie na Ethereum sieť
async function sendTransaction(providerUrl, privateKey, data) {
    const response = await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_sendTransaction",
            params: [{
                from: privateKey,
                to: data.to,
                gas: data.gasLimit,
                gasPrice: data.gasPrice,
                nonce: data.nonce,
                data: data.data
            }],
            id: 1
        })
    });
    return await response.json();
}