// /api/mintchain.js

module.exports = async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // Inicializácia providera cez Infura
        log("📊 [INFURA] Inicializácia providera...");
        const providerUrl = process.env.PROVIDER_URL; // Získajte Infura URL z env variable
        if (!providerUrl) {
            return res.status(400).json({ error: "PROVIDER_URL nie je nastavený!" });
        }

        // Príprava na volanie Infura API
        const infuraUrl = `${providerUrl}`;
        const provider = new URL(infuraUrl);
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const privateKey = process.env.PRIVATE_KEY;

        // Logovanie zostatku peňaženky
        log("📊 [INFURA] Kontrola zostatku peňaženky...");
        const walletBalance = await getBalance(privateKey, provider);
        log("💰 [BALANCE] Peňaženka má:", walletBalance, "ETH");

        if (parseFloat(walletBalance) < 0.0001) {
            log("⚠️ [BALANCE] Nedostatočný zostatok na gas.");
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // Volanie smart kontraktu cez Infura
        log("🚀 [INFURA] Volanie kontraktu...");
        const txHash = await mintNFT(metadataURI, crop_id, wallet, contractAddress, privateKey, provider);
        
        log("✅ [INFURA] Transakcia úspešná:", txHash);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            txHash: txHash
        });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ error: err.message });
    }
};

// Funkcia na získanie zostatku peňaženky z Infura
async function getBalance(privateKey, provider) {
    // Použite Infura na získanie zostatku
    const web3 = new Web3(provider);
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    const balance = await web3.eth.getBalance(account.address);
    return web3.utils.fromWei(balance, 'ether');
}

// Funkcia na volanie mintu cez Infura
async function mintNFT