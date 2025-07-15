// 🔍 Pomocná funkcia na overenie dostupnosti IPFS obrázka cez gateway
async function waitForImageAvailability(imageUrl, maxAttempts = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(imageUrl, { method: 'HEAD' });
    if (response.ok) return true;

    console.log(`⏳ [ČAKANIE] Pokus ${attempt}/${maxAttempts} – obrázok ešte nie je dostupný.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  const log = (...args) => console.log(`[${now}]`, ...args);

  if (req.method !== "POST") {
    log("❌ [CHYBA] Nepodporovaná HTTP metóda:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { crop_id, wallet, image_base64 } = req.body;
    log("📥 [VSTUP] Prijaté údaje:", {
      crop_id,
      wallet,
      image_base64_length: image_base64?.length || 0,
    });

    if (!crop_id || !wallet || !image_base64) {
      log("⚠️ [VALIDÁCIA] Neúplné vstupné údaje.");
      return res.status(400).json({ error: "Chýbajú údaje" });
    }

    const buffer = Buffer.from(image_base64, "base64");
    log("📡 [PINATA] Nahrávanie obrázka...");
    const formData = new FormData();
    formData.append("file", new Blob([buffer]), `${crop_id}.png`);

    const imageUpload = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
      },
      body: formData,
    });

    const imageResult = await imageUpload.json();
    log("🖼️ [PINATA] Výsledok obrázka:", imageResult);

    if (!imageResult.IpfsHash) {
      return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imageResult });
    }

    const imageURI = `https://gateway.pinata.cloud/ipfs/${imageResult.IpfsHash}`;

    // 🔍 Overenie dostupnosti obrázka cez HTTP
    log("🔍 Overujem dostupnosť obrázka...");
    const available = await waitForImageAvailability(imageURI);
    if (!available) {
      log("❌ Obrázok sa nepodarilo načítať z gateway ani po opakovaní.");
      return res.status(500).json({
        error: "Obrázok nie je dostupný cez IPFS gateway",
        ipfsHash: imageResult.IpfsHash
      });
    }

    const metadata = {
      name: `Chainvers NFT ${crop_id}`,
      description: "NFT z CHAINVERS",
      image: imageURI,
      attributes: [{ trait_type: "Crop ID", value: crop_id }],
    };

    log("📦 [PINATA] Nahrávanie metadát...");
    const metadataUpload = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataMetadata: {
          name: `chainvers-metadata-${crop_id}`,
        },
        pinataContent: metadata,
      }),
    });

    const metadataResult = await metadataUpload.json();
    log("📄 [PINATA] Výsledok metadát:", metadataResult);

    if (!metadataResult.IpfsHash) {
      return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
    }

    const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

    log("🚀 [CHAIN] Volanie mintchain...");
    const mintCall = await fetch(process.env.MINTCHAIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadataURI,
        crop_id,
        walletAddress: wallet,
      }),
    });

    const mintResult = await mintCall.json();

    if (!mintResult.success) {
      log("❌ [CHAIN] Mint zlyhal:", mintResult);
      return res.status(500).json({ error: "Mintovanie zlyhalo", detail: mintResult });
    }

    return res.status(200).json({
      success: true,
      message: "NFT vytvorený",
      metadata_cid: metadataResult.IpfsHash,
      txHash: mintResult.txHash,
    });
  } catch (err) {
    log("❌ [VÝNIMKA]", err.message);
    return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
  }
                    }
