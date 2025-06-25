export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [MINTCHAIN] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;

        if (!metadataURI || !crop_id || !wallet) {
            log("⚠️ [VALIDÁCIA] Neúplné vstupné údaje.");
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        log("📊 [ETHERS] Inicializácia providera...");
        const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        const balance = await provider.getBalance(signer.address);
        log("💰 [BALANCE] Peňaženka má:", ethers.formatEther(balance), "ETH");

        if (balance.lte(ethers.parseEther("0.0001"))) {
            log("❌ [BALANCE] Nedostatočný zostatok pre gas.");
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            [
                "function createOriginal(string memory imageURI, string memory cropId, address to) public"
            ],
            signer
        );

        log("📤 [ETHERS] Odosielam transakciu createOriginal...");
        const tx = await contract.createOriginal(metadataURI, crop_id, wallet);
        log("⏳ [ETHERS] Čakám na potvrdenie transakcie...");
        const receipt = await tx.wait();

        log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

        return res.status(200).json({
            success: true,
            message: "NFT vytvorené",
            txHash: receipt.transactionHash
        });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}