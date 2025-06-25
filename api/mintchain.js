export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        // Skontroluj prítomnosť environmentálnych premenných
        const providerUrl = process.env.PROVIDER_URL;
        const privateKey = process.env.PRIVATE_KEY;
        const contractAddress = process.env.CONTRACT_ADDRESS;

        if (!providerUrl || !privateKey || !contractAddress) {
            log("⚠️ [MINTCHAIN] Chýbajú potrebné environment variables.");
            return res.status(400).json({ error: "Missing environment variables" });
        }

        log("📊 [ETHERS] Inicializácia providera...");

        // Vytvor pripojenie cez Infura
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const signer = new ethers.Wallet(privateKey, provider);

        const balance = await provider.getBalance(signer.address);
        log("💰 [BALANCE] Peňaženka má:", ethers.formatEther(balance), "ETH");

        // Skontroluj, či má peňaženka dostatočný zostatok na zaplatenie transakčných poplatkov
        if (balance.lte(ethers.parseEther("0.0001"))) {
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        const contract = new ethers.Contract(
            contractAddress,
            [
                "function createOriginal(string memory imageURI, string memory cropId, address to) public"
            ],
            signer
        );

        log("📤 [ETHERS] Odosielam transakciu createOriginal...");
        const tx = await contract.createOriginal(metadataURI, crop_id, wallet);
        const receipt = await tx.wait();
        log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

        return res.status(200).json({ success: true, txHash: receipt.transactionHash });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}