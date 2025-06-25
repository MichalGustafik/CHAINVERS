export default async function handler(req, res) export default async function handler(req, res) {
  const now = new Date().toISOString();
  const log = (...args) => console.log(`[${now}]`, ...args);

  if (req.method !== "POST") {
    log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { metadataURI, crop_id, wallet } = req.body;
    log("📨 [MINTCHAIN] Prijaté dáta:", { metadataURI, crop_id, wallet });

    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const PROVIDER_URL = process.env.PROVIDER_URL;

    if (!CONTRACT_ADDRESS || !PRIVATE_KEY || !PROVIDER_URL) {
      throw new Error("❌ Chýbajú environmentálne premenné");
    }

    const abi = [{
      "inputs": [
        { "internalType": "string", "name": "imageURI", "type": "string" },
        { "internalType": "string", "name": "cropId", "type": "string" },
        { "internalType": "address", "name": "to", "type": "address" }
      ],
      "name": "createOriginal",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }];

    // Web3-like low-level call to Infura
    const callData = encodeCreateOriginal(metadataURI, crop_id, wallet);

    const txParams = {
      to: CONTRACT_ADDRESS,
      data: callData,
      gas: "500000", // Optional: adjust based on actual need
      chainId: 84532
    };

    // Send raw transaction via Infura
    const response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendTransaction",
        params: [txParams]
      })
    });

    const txJson = await response.json();

    if (txJson.error) {
      log("❌ [INFURA] Chyba:", txJson.error);
      return res.status(500).json({ success: false, error: txJson.error.message });
    }

    log("✅ [INFURA] Tx hash:", txJson.result);

    return res.status(200).json({
      success: true,
      txHash: txJson.result
    });

  } catch (err) {
    log("❌ [MINTCHAIN] Výnimka:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// Minimalistický encoder - sem môžeš vložiť ABI encoder (napr. z Remixu)
function encodeCreateOriginal(imageURI, cropId, to) {
  const Web3 = require("web3");
  const web3 = new Web3(); // iba na encoding
  return web3.eth.abi.encodeFunctionCall({
    name: "createOriginal",
    type: "function",
    inputs: [
      { type: "string", name: "imageURI" },
      { type: "string", name: "cropId" },
      { type: "address", name: "to" }
    ]
  }, [imageURI, cropId, to]);
}