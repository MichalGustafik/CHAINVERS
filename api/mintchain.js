// Importujeme potrebné moduly
export default async function handler(req, res) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    // Skontrolujeme, či je požiadavka POST
    if (req.method !== "POST") {
        log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        // Získame dáta z tela požiadavky
        const { metadataURI, walletAddress, crop_id } = req.body;

        // Skontrolujeme, či sú všetky potrebné parametre
        if (!metadataURI || !walletAddress || !crop_id) {
            log("⚠️ [MINTCHAIN] Chýbajú parametre metadataURI, walletAddress alebo crop_id.");
            return res.status(400).json({ error: "Missing required parameters" });
        }

        // Získanie environmentálnych premenných
        const providerUrl = process.env.PROVIDER_URL; // URL na Infura alebo Alchemy
        const privateKey = process.env.PRIVATE_KEY; // Privátny kľúč peňaženky
        const contractAddress = process.env.CONTRACT_ADDRESS; // Adresa smart kontraktu

        if (!providerUrl || !privateKey || !contractAddress) {
            log("⚠️ [MINTCHAIN] Chýbajú potrebné environmentálne premenné.");
            return res.status(400).json({ error: "Missing environment variables" });
        }

        log("📊 [INFURA] Inicializácia providera...");

        // Inicializácia pripojenia cez Infura (alebo Alchemy)
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const signer = new ethers.Wallet(privateKey, provider);

        // Získanie aktuálneho zostatku peňaženky
        const balance = await provider.getBalance(signer.address);
        log("💰 [BALANCE] Peňaženka má:", ethers.utils.formatEther(balance), "ETH");

        // Skontrolovanie, či je dostatok ETH na zaplatenie poplatkov za gas
        if (balance.lte(ethers.utils.parseEther("0.0001"))) {
            return res.status(400).json({ error: "Nedostatočný zostatok pre gas" });
        }

        // Definovanie ABI pre smart kontrakt
        const contractABI = [
            "function createOriginal(string memory imageURI, string memory cropId, address to) public"
        ];

        // Vytvorenie inštancie smart kontraktu
        const contract = new ethers.Contract(contractAddress, contractABI, signer);

        log("📤 [ETHERS] Odosielam transakciu na mintovanie...");

        // Odoslanie transakcie na blockchain
        const tx = await contract.createOriginal(metadataURI, crop_id, walletAddress);

        log("📊 [ETHERS] Transakcia odoslaná, čakám na potvrdenie...");

        // Čakanie na potvrdenie transakcie
        const receipt = await tx.wait();

        log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

        // Vrátenie transakčného hashu ako odpoveď
        return res.status(200).json({ success: true, txHash: receipt.transactionHash });
    } catch (err) {
        log("❌ [MINTCHAIN ERROR]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
}