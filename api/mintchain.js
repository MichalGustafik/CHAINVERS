const { ethers } = require("ethers");

async function mintNFT({ metadataURI, crop_id, wallet }) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    log("📊 [ETHERS] Inicializácia providera...");

    const rpcUrl = process.env.PROVIDER_URL;
    if (!rpcUrl) throw new Error("❌ PROVIDER_URL nie je nastavený");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // 💰 Kontrola zostatku
    const balance = await provider.getBalance(signer.address);
    const ethBalance = ethers.formatEther(balance);
    log(`💰 [BALANCE] Peňaženka má: ${ethBalance} ETH`);

    if (balance.lte(0)) {
        throw new Error("Nedostatočný zostatok v peňaženke");
    }

    const contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        [
            "function createOriginal(string memory imageURI, string memory cropId, address to) public"
        ],
        signer
    );

    log("📤 [ETHERS] Odosielanie transakcie createOriginal...");
    const tx = await contract.createOriginal(metadataURI, crop_id, wallet);
    log("⏳ [ETHERS] Čakám na potvrdenie transakcie...");
    const receipt = await tx.wait();
    log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);

    return {
        success: true,
        txHash: receipt.transactionHash
    };
}

module.exports = { mintNFT };