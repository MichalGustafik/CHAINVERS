// /api/chainwebhook.js
import FormData from "form-data";
import fetch from "node-fetch";
import Web3 from "web3";

export const maxDuration = 60;

const web3 = new Web3(process.env.PROVIDER_URL);
const CONTRACT = process.env.CONTRACT_ADDRESS;

const CONTRACT_ABI = [
  {
    constant: true,
    inputs: [],
    name: "tokenIdCounter",
    outputs: [{ name: "", type: "uint256" }],
    type: "function"
  }
];

const contract = CONTRACT
  ? new web3.eth.Contract(CONTRACT_ABI, CONTRACT)
  : null;

function log(msg, data = null) {
  const t = new Date().toISOString();
  if (data !== null) console.log(`[${t}] ${msg}`, data);
  else console.log(`[${t}] ${msg}`);
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForImageAvailability(imageUrl, maxAttempts = 3, delayMs = 2000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const resp = await fetch(imageUrl, { method: "HEAD" });
      log(`IPFS HEAD ${i}/${maxAttempts}`, {
        status: resp.status,
        ok: resp.ok
      });

      if (resp.ok) return true;
    } catch (e) {
      log(`IPFS HEAD ERROR ${i}/${maxAttempts}`, e.message);
    }

    await wait(delayMs);
  }

  return false;
}

async function safeJson(resp) {
  const text = await resp.text();

  try {
    return {
      ok: true,
      json: JSON.parse(text),
      raw: text
    };
  } catch (e) {
    return {
      ok: false,
      json: null,
      raw: text,
      error: e.message
    };
  }
}

async function getReceipt(txHash, maxTries = 15, delayMs = 3000) {
  for (let i = 1; i <= maxTries; i++) {
    try {
      const receipt = await web3.eth.getTransactionReceipt(txHash);

      if (receipt) {
        log("RECEIPT_FOUND", {
          try: i,
          status: receipt.status,
          blockNumber: receipt.blockNumber
        });
        return receipt;
      }

      log("RECEIPT_WAIT", { try: i });
    } catch (e) {
      log("RECEIPT_ERROR", e.message);
    }

    await wait(delayMs);
  }

  return null;
}

function extractTokenIdFromReceipt(receipt) {
  const transferTopic = web3.utils.keccak256("Transfer(address,address,uint256)");

  for (const lg of receipt.logs || []) {
    if (
      lg.topics &&
      lg.topics[0]?.toLowerCase() === transferTopic.toLowerCase() &&
      lg.topics.length >= 4
    ) {
      try {
        return web3.utils.hexToNumber(lg.topics[3]);
      } catch (e) {
        log("TOKEN_ID_EXTRACT_ERROR", e.message);
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  log("REQUEST_START", { method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed"
    });
  }

  try {
    const body = req.body || {};
    log("BODY_KEYS", Object.keys(body));

    const crop_id = body.crop_id;
    const wallet = body.wallet || body.walletAddress;
    const image_base64 = body.image_base64;

    if (!crop_id || !wallet || !image_base64) {
      log("MISSING_DATA", {
        has_crop_id: !!crop_id,
        has_wallet: !!wallet,
        has_image_base64: !!image_base64
      });

      return res.status(400).json({
        ok: false,
        success: false,
        error: "Chýbajú údaje",
        missing: {
          crop_id: !crop_id,
          wallet: !wallet,
          image_base64: !image_base64
        }
      });
    }

    if (!process.env.PINATA_JWT) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Missing PINATA_JWT"
      });
    }

    if (!process.env.MINTCHAIN_API_URL) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Missing MINTCHAIN_API_URL"
      });
    }

    if (!CONTRACT) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Missing CONTRACT_ADDRESS"
      });
    }

    log("STEP_1_UPLOAD_IMAGE_START");

    const buf = Buffer.from(image_base64, "base64");

    const form = new FormData();
    form.append("file", buf, {
      filename: `${crop_id}.png`,
      contentType: "image/png"
    });

    const imgRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
        ...form.getHeaders()
      },
      body: form
    });

    const imgParsed = await safeJson(imgRes);

    if (!imgParsed.ok || !imgParsed.json?.IpfsHash) {
      log("PINATA_IMAGE_FAIL", {
        status: imgRes.status,
        raw: imgParsed.raw?.slice(0, 500)
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error: "Nepodarilo sa nahrať obrázok",
        status: imgRes.status,
        detail: imgParsed.json || imgParsed.raw
      });
    }

    const imageCID = imgParsed.json.IpfsHash;
    const imageURI = `https://ipfs.io/ipfs/${imageCID}`;

    log("IMAGE_UPLOADED", { imageCID, imageURI });

    const ipfsReady = await waitForImageAvailability(imageURI);

    if (!ipfsReady) {
      log("IPFS_NOT_READY_BUT_CONTINUE", imageURI);
    }

    log("STEP_2_UPLOAD_METADATA_START");

    const metadata = {
      name: `Chainvers NFT ${crop_id}`,
      description: "Originálny NFT z Chainvers, ktorý reprezentuje unikátny dizajn.",
      image: imageURI,
      attributes: [
        { trait_type: "Crop ID", value: crop_id },
        { trait_type: "Category", value: "Art" },
        { trait_type: "Creator", value: "Chainvers Team" },
        { trait_type: "Edition", value: "Original" }
      ]
    };

    const metaRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
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

    const metaParsed = await safeJson(metaRes);

    if (!metaParsed.ok || !metaParsed.json?.IpfsHash) {
      log("PINATA_METADATA_FAIL", {
        status: metaRes.status,
        raw: metaParsed.raw?.slice(0, 500)
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error: "Nepodarilo sa nahrať metadáta",
        status: metaRes.status,
        detail: metaParsed.json || metaParsed.raw
      });
    }

    const metadataCID = metaParsed.json.IpfsHash;
    const metadataURI = `ipfs://${metadataCID}`;

    log("METADATA_UPLOADED", { metadataCID, metadataURI });

    log("STEP_3_MINT_START", {
      url: process.env.MINTCHAIN_API_URL,
      crop_id,
      walletAddress: wallet,
      metadataURI
    });

    const mintRes = await fetch(process.env.MINTCHAIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metadataURI,
        crop_id,
        walletAddress: wallet,
        wallet
      })
    });

    const mintParsed = await safeJson(mintRes);

    if (!mintParsed.ok) {
      log("MINT_INVALID_JSON", {
        status: mintRes.status,
        raw: mintParsed.raw?.slice(0, 1000)
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error: "Mint API nevrátilo validný JSON",
        status: mintRes.status,
        raw: mintParsed.raw
      });
    }

    const mintJson = mintParsed.json;

    log("MINT_RESPONSE", mintJson);

    const txHash =
      mintJson.txHash ||
      mintJson.tx ||
      mintJson.transactionHash ||
      null;

    const mintOk =
      mintJson.ok === true ||
      mintJson.success === true ||
      !!txHash;

    if (!mintOk || !txHash) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Mintovanie zlyhalo",
        detail: mintJson
      });
    }

    log("STEP_4_WAIT_RECEIPT", txHash);

    const receipt = await getReceipt(txHash);

    if (!receipt) {
      return res.status(200).json({
        ok: true,
        success: true,
        warning: "Mint prešiel, ale receipt ešte nie je dostupný",
        metadata_cid: metadataCID,
        metadataURI,
        txHash,
        contractAddress: CONTRACT,
        tokenId: mintJson.tokenId ?? mintJson.token_id ?? crop_id,
        cropId: crop_id,
        openseaUrl: `https://opensea.io/assets/base/${CONTRACT}/${mintJson.tokenId ?? mintJson.token_id ?? crop_id}`,
        copyMintUrl: `https://chainvers.free.nf/copymint.php?original=${encodeURIComponent(String(mintJson.tokenId ?? mintJson.token_id ?? crop_id))}&contract=${encodeURIComponent(CONTRACT)}`
      });
    }

    let tokenId = extractTokenIdFromReceipt(receipt);

    if (tokenId === null && mintJson.tokenId !== undefined) {
      tokenId = mintJson.tokenId;
    }

    if (tokenId === null && mintJson.token_id !== undefined) {
      tokenId = mintJson.token_id;
    }

    if (tokenId === null && contract) {
      try {
        const counter = await contract.methods.tokenIdCounter().call();
        tokenId = parseInt(counter, 10) - 1;
        log("TOKEN_ID_FROM_COUNTER", { counter, tokenId });
      } catch (e) {
        log("TOKEN_ID_COUNTER_FAIL", e.message);
      }
    }

    if (tokenId === null || tokenId === undefined || Number.isNaN(tokenId)) {
      tokenId = crop_id;
    }

    const tokenIdStr = String(tokenId);

    const openseaUrl = `https://opensea.io/assets/base/${CONTRACT}/${tokenIdStr}`;
    const copyMintUrl = `https://chainvers.free.nf/copymint.php?original=${encodeURIComponent(tokenIdStr)}&contract=${encodeURIComponent(CONTRACT)}`;

    log("SUCCESS_RESPONSE", {
      txHash,
      tokenId: tokenIdStr,
      contractAddress: CONTRACT
    });

    return res.status(200).json({
      ok: true,
      success: true,
      message: "NFT úspešne vytvorený",
      metadata_cid: metadataCID,
      metadataURI,
      txHash,
      contractAddress: CONTRACT,
      tokenId: tokenIdStr,
      cropId: crop_id,
      openseaUrl,
      copyMintUrl
    });

  } catch (err) {
    console.error("CHAINWEBHOOK ERROR:", err);

    return res.status(500).json({
      ok: false,
      success: false,
      error: "Interná chyba servera",
      detail: err?.message || String(err),
      stack: err?.stack || null
    });
  }
}