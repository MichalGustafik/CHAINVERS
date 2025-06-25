export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

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

        // Získame environment variables
        const infuraUrl = process.env.INFURA_URL; // Infura RPC URL
        const privateKey = process.env.PRIVATE_KEY; // Private key pre podpisovanie transakcií
        const contractAddress = process.env.CONTRACT_ADDRESS; // Adresa smart kontraktu

        if (!infuraUrl || !privateKey || !contractAddress) {
            log("⚠️ [MINTCHAIN] Chýbajú potrebné environment variables.");
            return res.status(400).json({ error: "Chýbajú potrebné environment variables." });
        }

        log("📡 [INFURA] Infura URL:", infuraUrl);
        log("🔑 [PRIVATE_KEY] Používame private key pre podpisovanie transakcie.");
        
        // Pripravíme údaje pre transakciu
        const nonce = await getNonce(wallet, infuraUrl);  // Musíme získať nonce pre adresu
        const gasPrice = await getGasPrice(infuraUrl);  // Získame cenu za plyn z Infura

        // Vytvoríme transakciu
        const transaction = {
            to: contractAddress,
            gasLimit: 2000000, // predpokladaná hodnota
            gasPrice: gasPrice,
            data: createTransactionData(metadataURI, crop_id, wallet), // Skladáme dáta pre smart kontrakt
            nonce: nonce,
            chainId: 3 // Testovacia sieť (Ropsten), zmeňte na správnu pre Mainnet alebo iné testovacie siete
        };

        // Podpíšeme transakciu s privátnym kľúčom
        const signedTx = await signTransaction(transaction, privateKey);

        // Odoslanie transakcie na Infura
        const response = await sendTransaction(signedTx, infuraUrl);
        
        log("✅ [MINTCHAIN] Transakcia odoslaná:", response);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            txHash: response.result
        });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}

async function getNonce(wallet, infuraUrl) {
    const url = `${infuraUrl}/eth_getTransactionCount?params=["${wallet}", "latest"]`;
    const response = await fetch(url, { method: "POST" });
    const data = await response.json();
    return parseInt(data.result, 16); // prevod na číselnú hodnotu
}

async function getGasPrice(infuraUrl) {
    const url = `${infuraUrl}/eth_gasPrice`;
    const response = await fetch(url, { method: "POST" });
    const data = await response.json();
    return data.result;
}

function createTransactionData(metadataURI, crop_id, wallet) {
    const functionSignature = "createOriginal(string,string,address)"; // Funkcia v smart kontrakte
    const encodedData = encodeParameters(functionSignature, [metadataURI, crop_id, wallet]);
    return encodedData;
}

// Toto je na zakódovanie dát, ktoré sa odosielajú do smart kontraktu
function encodeParameters(functionSignature, params) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode([functionSignature], params);
}

async function signTransaction(transaction, privateKey) {
    const web3 = new Web3();
    const signedTx = await web3.eth.accounts.signTransaction(transaction, privateKey);
    return signedTx.rawTransaction;
}

async function sendTransaction(signedTx, infuraUrl) {
    const url = `${infuraUrl}/eth_sendRawTransaction`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransaction", params: [signedTx], id: 1 })
    });
    return response.json();
}