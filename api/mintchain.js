module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // === 1. Získanie balance peňaženky ===
        log("📊 [INFURA] Inicializácia providera...");

        const infuraUrl = process.env.PROVIDER_URL;
        const infuraApiKey = process.env.INFURA_API_KEY;  // Infura API kľúč
        if (!infuraUrl || !infuraApiKey) {
            throw new Error("❌ Infura URL alebo API kľúč nie je nastavený!");
        }

        const provider = new URL(infuraUrl);
        const balance = await getBalance(provider, wallet, infuraApiKey);
        log("💰 [BALANCE] Peňaženka má:", balance, "ETH");

        // Overenie, či je dostatočný zostatok na gas
        if (balance < 0.0001) {
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // === 2. Vytvorenie transakcie ===
        log("🚀 [INFURA] Volanie kontraktu...");

        const contractAddress = process.env.CONTRACT_ADDRESS;
        const privateKey = process.env.PRIVATE_KEY;

        const txData = await createTransactionData(metadataURI, crop_id, wallet, contractAddress, privateKey);
        const tx = await sendTransaction(provider, infuraApiKey, txData);
        log("✅ [ETHERS] Transakcia potvrdená:", tx.transactionHash);

        // === 3. Nahrávanie metadát na Pinatu ===
        const imageURI = `https://ipfs.io/ipfs/${metadataURI}`;  // Predpokladáme, že metadata obsahuje IPFS URL

        const metadata = {
            name: `Chainvers NFT ${crop_id}`,
            description: "NFT z CHAINVERS",
            image: imageURI,
            attributes: [{ trait_type: "Crop ID", value: crop_id }]
        };

        log("📦 [PINATA] Nahrávanie metadát...");
        const metadataResult = await uploadToPinata(metadata);

        log("📄 [PINATA] Výsledok metadát:", metadataResult);

        if (!metadataResult.IpfsHash) {
            log("❌ [PINATA] Nepodarilo sa nahrať metadáta.");
            return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
        }

        return res.status(200).json({ success: true, txHash: tx.transactionHash });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// Funkcia na získanie balance peňaženky z Infura
async function getBalance(provider, wallet, infuraApiKey) {
    const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [wallet, "latest"]
    };

    const response = await fetch(`${provider.href}?apiKey=${infuraApiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();
    const balanceInWei = parseInt(result.result, 16); // Ethereum je v jednotkách Wei
    return balanceInWei / 1e18; // Prevod z Wei na ETH
}

// Funkcia na odoslanie transakcie do Infura
async function sendTransaction(provider, infuraApiKey, txData) {
    const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendTransaction",
        params: [{
            ...txData,
            gas: "0x5208", // 21000 v hex
            gasPrice: "0x09184e72a000", // Nízka cena gasu pre testovaciu sieť
        }]
    };

    const response = await fetch(`${provider.href}?apiKey=${infuraApiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();
    return result.result; // Transaction hash
}

// Funkcia na vytvorenie dát pre transakciu
async function createTransactionData(metadataURI, crop_id, wallet, contractAddress, privateKey) {
    // Vytvorte správnu štruktúru dát pre transakciu
    return {
        to: contractAddress,
        data: `0x...` // Tu bude vytvorený správny dáta pre volanie kontraktu
    };
}

// Funkcia na upload metadát na Pinatu
async function uploadToPinata(metadata) {
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.PINATA_JWT}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            pinataMetadata: {
                name: `chainvers-metadata`
            },
            pinataContent: metadata
        })
    });

    return await response.json();
}