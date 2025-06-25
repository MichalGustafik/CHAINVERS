import { ethers } from "ethers";

export async function mintNFT({ crop_id, wallet, image_base64 }) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);

    try {
        const buffer = Buffer.from(image_base64, "base64");

        // === 1. Upload obrázka na Pinatu ===
        log("📡 [PINATA] Nahrávanie obrázka...");
        const formData = new FormData();
        formData.append("file", new Blob([buffer]), `${crop_id}.png`);

        const imageUpload = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PINATA_JWT}`
            },
            body: formData
        });

        const imageResult = await imageUpload.json();
        log("🖼️ [PINATA] Výsledok obrázka:", imageResult);

        if (!imageResult.IpfsHash) {
            log("❌ [PINATA] Obrázok sa nepodarilo nahrať.");
            throw new Error("Nepodarilo sa nahrať obrázok");
        }

        const imageURI = `ipfs://${imageResult.IpfsHash}`;

        // === 2. Upload metadát ===
        const metadata = {
            name: `Chainvers NFT ${crop_id}`,
            description: "NFT z CHAINVERS",
            image: imageURI,
            attributes: [{ trait_type: "Crop ID", value: crop_id }]
        };

        log("📦 [PINATA] Nahrávanie metadát...");
        const metadataUpload = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PINATA_JWT}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                pinataMetadata: {
                    name: `chainvers-metadata-${crop_id}`
                },
                pinataContent: metadata
            })
        });

        const metadataResult = await metadataUpload.json();
        log("📄 [PINATA] Výsledok metadát:", metadataResult);

        if (!metadataResult.IpfsHash) {
            log("❌ [PINATA] Nepodarilo sa nahrať metadáta.");
            throw new Error("Nepodarilo sa nahrať metadáta");
        }

        const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

        // === 3. Volanie kontraktu ===
        log("🚀 [ETHERS] Príprava volania kontraktu...");

        const rpcUrl = process.env.PROVIDER_URL;
        if (!rpcUrl) throw new Error("❌ PROVIDER_URL nie je nastavený!");

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

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

        return metadataURI;

    } catch (err) {
        throw new Error(`❌ Chyba pri mintovaní NFT: ${err.message}`);
    }
}