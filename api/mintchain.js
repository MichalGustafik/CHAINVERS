export default async function handler(req, res) {
  const now = new Date().toISOString();
  const log = (...args) => console.log(`[${now}]`, ...args);

  if (req.method !== "POST") {
    log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { metadataURI, crop_id, wallet } = req.body;
    log("📥 [MINTCHAIN] Dáta:", { metadataURI, crop_id, wallet });

    // 🔐 Získanie údajov z ENV
    const rpcUrl = process.env.PROVIDER_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const contractAddress = process.env.CONTRACT_ADDRESS;

    if (!rpcUrl || !privateKey || !contractAddress) {
      throw new Error("Chýbajú environment variables");
    }

    // 📡 Príprava JSON RPC požiadavky (Infura)
    const callData = {
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: ["0x..."], // Tu bude hex podpísaná transakcia (implementácia bez knižníc je rozsiahlejšia)
      id: 1,
    };

    log("🚀 [MINTCHAIN] Posielam požiadavku cez Infura...");
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callData),
    });

    const json = await response.json();
    if (!json.result) {
      throw new Error(`Chyba RPC: ${JSON.stringify(json.error || json)}`);
    }

    log("✅ [MINTCHAIN] TX hash:", json.result);

    return res.status(200).json({ success: true, txHash: json.result });
  } catch (err) {
    log("❌ [MINTCHAIN ERROR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}