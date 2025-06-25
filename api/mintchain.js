export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        // Prijaté údaje
        const { metadataURI, crop_id, wallet } = req.body;
        log("📥 [VSTUP] Prijaté údaje:", { metadataURI, crop_id, wallet });

        // === 1. Overenie zostatku v peňaženke ===
        const rpcUrl = process.env.PROVIDER_URL;  // Infura URL
        const provider = new URL(rpcUrl);

        const balanceRequest = {
            method: 'eth_getBalance',
            params: [wallet, 'latest'],
            id: 1,
            jsonrpc: '2.0',
        };

        const balanceResponse = await fetch(provider, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(balanceRequest),
        });

        const balanceResult = await balanceResponse.json();
        log("💰 [BALANCE] Zostatok peňaženky:", balanceResult.result);

        const balanceInEth = parseInt(balanceResult.result, 16) / 1e18;
        log("💰 [BALANCE] Zostatok v ETH:", balanceInEth);

        if (balanceInEth < 0.0001) {
            log("⚠️ [BALANCE] Nedostatočný zostatok na transakciu.");
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // === 2. Vytvorenie transakcie s kontraktom ===
        const contractAddress = process.env.CONTRACT_ADDRESS; // adresa kontraktu
        const privateKey = process.env.PRIVATE_KEY; // privátny kľúč peňaženky
        const contractABI = [
            "function createOriginal(string memory imageURI, string memory cropId, address to) public"
        ];

        // Vytvorenie transakcie pre kontrakt
        const transaction = {
            from: wallet,
            to: contractAddress,
            data: `0x${createTransactionData(metadataURI, crop_id, wallet)}`,
            gas: '0x5208', // 21000 Gwei pre jednoduchú transakciu
        };

        const signedTransaction = await signTransaction(transaction, privateKey);
        const sendTransactionRequest = {
            method: 'eth_sendRawTransaction',
            params: [signedTransaction],
            id: 1,
            jsonrpc: '2.0',
        };

        const sendTransactionResponse = await fetch(provider, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendTransactionRequest),
        });

        const transactionResult = await sendTransactionResponse.json();
        log("✅ [ETHERS] Transakcia odoslaná:", transactionResult.result);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            txHash: transactionResult.result,
        });

    } catch (err) {
        log("❌ [VÝNIMKA]", err.message);
        return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
    }
}

// Funkcia na vytvorenie údajov pre transakciu
function createTransactionData(metadataURI, cropId, wallet) {
    const data = web3.eth.abi.encodeParameters(
        ['string', 'string', 'address'],
        [metadataURI, cropId, wallet]
    );
    return data;
}

// Funkcia na podpísanie transakcie
async function signTransaction(transaction, privateKey) {
    const tx = {
        nonce: await getNonce(transaction.from),
        gasPrice: await getGasPrice(),
        ...transaction,
    };

    // Podpísať transakciu pomocou privátneho kľúča
    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
    return signedTx.rawTransaction;
}

// Funkcia na získanie nonce
async function getNonce(address) {
    const nonceRequest = {
        method: 'eth_getTransactionCount',
        params: [address, 'latest'],
        id: 1,
        jsonrpc: '2.0',
    };

    const nonceResponse = await fetch(provider, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(nonceRequest),
    });

    const nonceResult = await nonceResponse.json();
    return nonceResult.result;
}

// Funkcia na získanie ceny plynu
async function getGasPrice() {
    const gasPriceRequest = {
        method: 'eth_gasPrice',
        id: 1,
        jsonrpc: '2.0',
    };

    const gasPriceResponse = await fetch(provider, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(gasPriceRequest),
    });

    const gasPriceResult = await gasPriceResponse.json();
    return gasPriceResult.result;
}