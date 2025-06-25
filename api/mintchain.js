export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { metadataURI, crop_id, wallet } = req.body;
        log("📥 [VSTUP] Prijaté údaje:", { metadataURI, crop_id, wallet });

        if (!metadataURI || !crop_id || !wallet) {
            log("⚠️ [VALIDÁCIA] Neúplné údaje.");
            return res.status(400).json({ error: "Chýbajú údaje" });
        }

        // Odstránime "ipfs://" z metadataURI
        const cleanedMetadataURI = metadataURI.replace('ipfs://', '');

        // === 1. Inicializácia Infura provider ===
        const infuraUrl = process.env.PROVIDER_URL; // Infura URL pre Sepolia
        const privateKey = process.env.PRIVATE_KEY; // Private key pre peňaženku

        if (!infuraUrl || !privateKey) {
            log("❌ [CHAIN] Chýbajú Infura URL alebo Private Key.");
            return res.status(500).json({ error: "Nastavenie Infura alebo private key chýba" });
        }

        const provider = new URL(infuraUrl);
        const signer = new ethers.Wallet(privateKey, provider);

        // === 2. Kontrola zostatku ===
        const balance = await provider.getBalance(signer.address);
        log("💰 [BALANCE] Peňaženka má:", ethers.formatEther(balance), "ETH");

        if (balance.lte(ethers.parseEther("0.0001"))) {
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // === 3. Volanie kontraktu ===
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            [
                "function createOriginal(string memory imageURI, string memory cropId, address to) public"
            ],
            signer
        );

        log("📤 [ETHERS] Odosielanie transakcie createOriginal...");
        const tx = await contract.createOriginal(cleanedMetadataURI, crop_id, wallet);
        const receipt = await tx.wait();

        log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

        return res.status(200).json({ success: true, txHash: receipt.transactionHash });

    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}