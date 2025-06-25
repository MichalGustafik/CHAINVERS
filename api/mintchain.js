import { ethers } from "ethers";

export async function mintchain(metadataURI, cropId, wallet) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    log("📊 [ETHERS] Inicializácia providera...");
    const rpcUrl = process.env.PROVIDER_URL;
    if (!rpcUrl) throw new Error("❌ PROVIDER_URL nie je nastavený!");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const balance = await provider.getBalance(signer.address);
    const ethBalance = ethers.formatEther(balance);
    log(`💰 [BALANCE] Peňaženka má: ${ethBalance} ETH`);

    if (balance.lte(0)) {
        throw new Error("Nedostatočný zostatok na transakciu");
    }

    const contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        [
            "function createOriginal(string memory imageURI, string memory cropId, address to) public"
        ],
        signer
    );

    log("📤 [ETHERS] Odosielam transakciu createOriginal...");
    const tx = await contract.createOriginal(metadataURI, cropId, wallet);

    log("⏳ [ETHERS] Čakám na potvrdenie...");
    const receipt = await tx.wait();

    log("✅ [ETHERS] Hotovo. TX hash:", receipt.transactionHash);
    return {
        txHash: receipt.transactionHash
    };
}