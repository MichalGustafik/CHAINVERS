import FormData from 'form-data';
import fetch from 'node-fetch';

const globalLog = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

export default async function handler(req, res) {
  const log = globalLog;

  if (req.method !== 'POST') {
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

    const filename = `${crop_id}.png`;
    const metadataFilename = `chainvers-metadata-${crop_id}.json`;

    let imageCID = null;
    let metadataCID = null;

    // ✅ Overenie, či obrázok už existuje
    log("🔍 [PINATA] Hľadanie existujúceho obrázka...");
    const pinImageListRes = await fetch(`https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=${filename}`, {
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    });
    const pinImageList = await pinImageListRes.json();
    if (pinImageList?.count > 0 && pinImageList.rows[0]?.ipfs_pin_hash) {
      imageCID = pinImageList.rows[0].ipfs_pin_hash;
      log("♻️ [PINATA] Obrázok už existuje:", imageCID);
    } else {
      log("📡 [PINATA] Nahrávanie nového obrázka...");
      const buffer = Buffer.from(image_base64, "base64");
      const formData = new FormData();
      formData.append("file", buffer, {
        filename: filename,
        contentType: "image/png"
      });

      const imageUpload = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PINATA_JWT}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });

      const imageResult = await imageUpload.json();
      if (!imageResult.IpfsHash) {
        log("❌ [PINATA] Nahrávanie obrázka zlyhalo:", imageResult);
        return res.status(500).json({ error: "Nepodarilo sa nahrať obrázok", detail: imageResult });
      }
      imageCID = imageResult.IpfsHash;
      log("✅ [PINATA] Obrázok nahraný:", imageCID);
    }

    const imageURI = `https://ipfs.io/ipfs/${imageCID}`;

    // ✅ Overenie, či metadáta už existujú
    log("🔍 [PINATA] Hľadanie existujúcich metadát...");
    const pinMetaListRes = await fetch(`https://api.pinata.cloud/data/pinList?status=pinned&metadata[name]=${metadataFilename}`, {
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
    });
    const pinMetaList = await pinMetaListRes.json();
    if (pinMetaList?.count > 0 && pinMetaList.rows[0]?.ipfs_pin_hash) {
      metadataCID = pinMetaList.rows[0].ipfs_pin_hash;
      log("♻️ [PINATA] Metadáta už existujú:", metadataCID);
    } else {
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
            name: metadataFilename,
          },
          pinataContent: metadata,
        }),
      });

      const metadataResult = await metadataUpload.json();
      if (!metadataResult.IpfsHash) {
        log("❌ [PINATA] Nahrávanie metadát zlyhalo:", metadataResult);
        return res.status(500).json({ error: "Nepodarilo sa nahrať metadáta", detail: metadataResult });
      }
      metadataCID = metadataResult.IpfsHash;
      log("✅ [PINATA] Metadáta nahrané:", metadataCID);
    }

    const metadataURI = `ipfs://${metadataCID}`;

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
      metadata_cid: metadataCID,
      txHash: mintResult.txHash,
    });

  } catch (err) {
    log("❌ [VÝNIMKA]", err.message);
    return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
  }
}
