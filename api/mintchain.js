// mintchain.js import { ethers } from "ethers";

export async function mintNFT({ metadataURI, crop_id, wallet }) { const now = new Date().toISOString(); const log = (...args) => console.log([${now}], ...args);

try {
    log("📊 [ETHERS] Inicializácia providera...");
    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL);
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    // Zistenie zostatku peňaženky
    const balance = await provider.getBalance(signer.address);
    const ethBalance = ethers.formatEther(balance);
    log(`💰 [BALANCE] Peňaženka má: ${ethBalance} ETH`);

    // Kontrola, či je zostatok dostatočný
    const minimumRequired = ethers.parseEther("0.0001");
    if (balance < minimumRequired) {
        throw new Error("Nedostatočný zostatok na gas");
    }

    // Získaj aktuálny gas price z Infura Gas API
    log("⛽ [GAS] Načítavanie gas cien z INFURA...");
    const gasResponse = await fetch(process.env.INFURA_GAS_API);
    const gasData = await gasResponse.json();

    const maxFeePerGas = ethers.parseUnits(
        gasData.estimatedPrices[0].maxFeePerGas.toString(),
        "gwei"
    );
    const maxPriorityFeePerGas = ethers.parseUnits(
        gasData.estimatedPrices[0].maxPriorityFeePerGas.toString(),
        "gwei"
    );

    log("📐 [GAS] maxFeePerGas:", maxFeePerGas.toString());
    log("📐 [GAS] maxPriorityFeePerGas:", maxPriorityFeePerGas.toString());

    // Inicializácia kontraktu
    const contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        [
            "function createOriginal(string memory imageURI, string memory cropId, address to) public"
        ],
        signer
    );

    log("📤 [ETHERS] Odosielanie transakcie createOriginal...");
    const tx = await contract.createOriginal(
        metadataURI,
        crop_id,
        wallet,
        {
            maxFeePerGas,
            maxPriorityFeePerGas,
        }
    );

    log("⏳ [ETHERS] Čakám na potvrdenie transakcie...");
    const receipt = await tx.wait();

    log("✅ [ETHERS] Transakcia potvrdená:", receipt.transactionHash);
    return {
        success: true,
        txHash: receipt.transactionHash
    };
} catch (err) {
    log("❌ [VÝNIMKA]", err.message);
    throw err;
}

}

