import https from "https"; // Vstavaný Node.js modul pre HTTPS požiadavky

export default async function mintNFT({ crop_id, wallet, image_base64 }) {
    const now = new Date().toISOString();
    const log = (...args) => console.log(`[${now}]`, ...args);
    
    try {
        const buffer = Buffer.from(image_base64, "base64");
        
        // === 1. Upload obrázka na Pinatu ===
        log("📡 [PINATA] Nahrávanie obrázka...");
        const formData = new FormData();
        formData.append("file", new Blob([buffer]), `${crop_id}.png`);
        
        const requestOptions = {
            hostname: "api.pinata.cloud",
            port: 443,
            path: "/pinning/pinFileToIPFS",
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.PINATA_JWT}`,
            },
        };
        
        const imageUpload = await new Promise((resolve, reject) => {
            const req = https.request(requestOptions, (res) => {
                let data = "";
                
                res.on("data", (chunk) => {
                    data += chunk;
                });
                
                res.on("end", () => {
                    resolve(JSON.parse(data));
                });
            });
            
            req.on("error", (err) => {
                reject(err);
            });
            
            req.write(formData);
            req.end();
        });
        
        log("🖼️ [PINATA] Výsledok obrázka:", imageUpload);
        
        if (!imageUpload.IpfsHash) {
            log("❌ [PINATA] Obrázok sa nepodarilo nahrať.");
            throw new Error("Nepodarilo sa nahrať obrázok");
        }
        
        const imageURI = `ipfs://${imageUpload.IpfsHash}`;
        
        // === 2. Upload metadát ===
        const metadata = {
            name: `Chainvers NFT ${crop_id}`,
            description: "NFT z CHAINVERS",
            image: imageURI,
            attributes: [{ trait_type: "Crop ID", value: crop_id }],
        };
        
        log("📦 [PINATA] Nahrávanie metadát...");
        
        const metadataUpload = await new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: "api.pinata.cloud",
                    port: 443,
                    path: "/pinning/pinJSONToIPFS",
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${process.env.PINATA_JWT}`,
                        "Content-Type": "application/json",
                    },
                },
                (res) => {
                    let data = "";
                    
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    
                    res.on("end", () => {
                        resolve(JSON.parse(data));
                    });
                }
            );
            
            req.on("error", (err) => {
                reject(err);
            });
            
            req.write(
                JSON.stringify({
                    pinataMetadata: {
                        name: `chainvers-metadata-${crop_id}`,
                    },
                    pinataContent: metadata,
                })
            );
            req.end();
        });
        
        log("📄 [PINATA] Výsledok metadát:", metadataUpload);
        
        if (!metadataUpload.IpfsHash) {
            log("❌ [PINATA] Nepodarilo sa nahrať metadáta.");
            throw new Error("Nepodarilo sa nahrať metadáta");
        }
        
        const metadataURI = `ipfs://${metadataUpload.IpfsHash}`;
        
        // === 3. Volanie smart kontraktu cez RPC ===
        log("🚀 [ETHERS] Príprava volania kontraktu...");
        
        const rpcUrl = process.env.PROVIDER_URL;
        if (!rpcUrl) throw new Error("❌ PROVIDER_URL nie je nastavený!");
        
        // Volanie kontraktu cez RPC
        const txData = {
            to: process.env.CONTRACT_ADDRESS,
            data: `0x${process.env.CONTRACT_ABI}...`, // Zadajte ABI a údaje pre volanie funkcie
            value: "0x0", // Ak potrebujete poslať ETH, nastavte správnu hodnotu
        };
        
        const txResponse = await new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: rpcUrl,
                    port: 443,
                    path: "/",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
                (res) => {
                    let data = "";
                    
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    
                    res.on("end", () => {
                        resolve(JSON.parse(data));
                    });
                }
            );
            
            req.on("error", (err) => {
                reject(err);
            });
            
            req.write(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_sendTransaction",
                    params: [txData],
                })
            );
            req.end();
        });
        
        log("📤 [ETHERS] Transakcia odoslaná:", txResponse);
        
        if (!txResponse.result) {
            log("❌ [ETHERS] Transakcia zlyhala.");
            throw new Error("Transakcia zlyhala");
        }
        
        return metadataURI;
    } catch (err) {
        throw new Error(`❌ Chyba pri mintovaní NFT: ${err.message}`);
    }
}