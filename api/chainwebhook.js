import FormData from 'form-data';
import fetch from 'node-fetch';

const globalLog = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// 🔮 Získa unikátny citát pre description
async function fetchUniqueDescription() {
  try {
    const res = await fetch('https://api.quotable.io/random');
    const data = await res.json();
    if (data && data.content) {
      return `Originálny NFT z Chainvers, ktorý "${data.content}"`;
    }
  } catch {}
  return `Originálny NFT z Chainvers, ktorý reprezentuje unikátny dizajn.`; // fallback
}

export default async function handler(req, res) {
  const log = globalLog;

  if (req.method !== 'POST') {
    log("❌ Nepodporovaná metóda:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { crop_id, wallet, image_base64 } = req.body;

    log("📥 Prijaté vstupy:", {
      crop_id,
      wallet,
      image_base64_length: image_base64?.length || 0,
    });

    if (!crop_id || !wallet || !image_base64) {
      return res.status(400).json({ error: "Chýbajú údaje" });
    }

    const filename = `${crop_id}.png`;
    const buffer = Buffer.from(image_base64, "base64");

    // 🔼 Upload obrázka na Pinata
    const formData = new FormData();
    formData.append("file", buffer, {
      filename,
      contentType: "image/png",
    });

    log("📡 Upload obrázka na Pinata...");
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
      return res.status(500).json({ error: "Nahrávanie obrázka zlyhalo", detail: imageResult });
    }

    const imageURI = `ipfs://${imageResult.IpfsHash}`;
    const description = await fetchUniqueDescription();

    const metadata = {
      name: `Chainvers NFT #${crop_id}`,
      description,
      image: imageURI,
      attributes: [
        { trait_type: "Category", value: "Art" },
        { trait_type: "Creator", value: "Chainvers Team" },
        { trait_type: "Edition", value: "Original" }
      ]
    };

    log("📦 Upload metadát...");
    const metadataUpload = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataMetadata: {
          name: "metadata.json"
        },
        pinataContent: metadata
      }),
    });

    const metadataResult = await metadataUpload.json();
    if (!metadataResult.IpfsHash) {
      return res.status(500).json({ error: "Nahrávanie metadát zlyhalo", detail: metadataResult });
    }

    const metadataURI = `ipfs://${metadataResult.IpfsHash}`;

    // 🔗 Zavolaj mintchain API
    log("🚀 Volám mintchain.js...");
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
      return res.status(500).json({ error: "Mintovanie zlyhalo", detail: mintResult });
    }

    return res.status(200).json({
      success: true,
      message: "NFT vytvorený",
      metadata_cid: metadataResult.IpfsHash,
      txHash: mintResult.txHash,
    });

  } catch (err) {
    log("❌ Výnimka:", err.message);
    return res.status(500).json({ error: "Interná chyba servera", detail: err.message });
  }
}
