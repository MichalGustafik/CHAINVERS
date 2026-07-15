// /api/chainwebhook.js
import FormData from "form-data";
import fetch from "node-fetch";
import Web3 from "web3";

export const maxDuration = 60;

const web3 = new Web3(process.env.PROVIDER_URL);
const CONTRACT = process.env.CONTRACT_ADDRESS;

const MINTCHAIN_API_URL =
  process.env.MINTCHAIN_API_URL ||
  "https://chainvers.vercel.app/api/chainvers?action=mintchain";

function log(msg, data = null) {
  const t = new Date().toISOString();

  if (data !== null) {
    console.log(`[${t}] ${msg}`, data);
  } else {
    console.log(`[${t}] ${msg}`);
  }
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

export default async function handler(req, res) {
  log("REQUEST_START", {
    method: req.method
  });

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
    const wallet =
      body.wallet ||
      body.walletAddress;

    let image_base64 =
      body.image_base64;

    if (
      !crop_id ||
      !wallet ||
      !image_base64
    ) {
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

    if (!CONTRACT) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Missing CONTRACT_ADDRESS"
      });
    }

    image_base64 = String(
      image_base64
    ).replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      ""
    );

    if (!image_base64) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Obrázok je prázdny"
      });
    }

    log("STEP_1_UPLOAD_IMAGE_START");

    const buf = Buffer.from(
      image_base64,
      "base64"
    );

    if (!buf.length) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Obrázok sa nepodarilo dekódovať"
      });
    }

    const form = new FormData();

    form.append(
      "file",
      buf,
      {
        filename: `${crop_id}.png`,
        contentType: "image/png"
      }
    );

    const imgRes = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PINATA_JWT}`,
          ...form.getHeaders()
        },
        body: form
      }
    );

    const imgParsed =
      await safeJson(imgRes);

    if (
      !imgRes.ok ||
      !imgParsed.ok ||
      !imgParsed.json?.IpfsHash
    ) {
      log("PINATA_IMAGE_FAIL", {
        status: imgRes.status,
        raw:
          imgParsed.raw?.slice(
            0,
            1000
          )
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error:
          "Nepodarilo sa nahrať obrázok",
        status: imgRes.status,
        detail:
          imgParsed.json ||
          imgParsed.raw
      });
    }

    const imageCID =
      imgParsed.json.IpfsHash;

    const imageURI =
      `https://ipfs.io/ipfs/${imageCID}`;

    log("IMAGE_UPLOADED", {
      imageCID,
      imageURI
    });

    log("STEP_2_UPLOAD_METADATA_START");

    const metadata = {
      name:
        `Chainvers NFT ${crop_id}`,

      description:
        "Originálny NFT z Chainvers, ktorý reprezentuje unikátny dizajn.",

      image:
        imageURI,

      attributes: [
        {
          trait_type: "Crop ID",
          value: crop_id
        },
        {
          trait_type: "Category",
          value: "Art"
        },
        {
          trait_type: "Creator",
          value: "Chainvers Team"
        },
        {
          trait_type: "Edition",
          value: "Original"
        }
      ]
    };

    const metaRes = await fetch(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.PINATA_JWT}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          pinataMetadata: {
            name:
              `chainvers-metadata-${crop_id}`
          },
          pinataContent:
            metadata
        })
      }
    );

    const metaParsed =
      await safeJson(metaRes);

    if (
      !metaRes.ok ||
      !metaParsed.ok ||
      !metaParsed.json?.IpfsHash
    ) {
      log("PINATA_METADATA_FAIL", {
        status: metaRes.status,
        raw:
          metaParsed.raw?.slice(
            0,
            1000
          )
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error:
          "Nepodarilo sa nahrať metadáta",
        status: metaRes.status,
        detail:
          metaParsed.json ||
          metaParsed.raw
      });
    }

    const metadataCID =
      metaParsed.json.IpfsHash;

    const metadataURI =
      `ipfs://${metadataCID}`;

    log("METADATA_UPLOADED", {
      metadataCID,
      metadataURI
    });

    log("STEP_3_MINT_START", {
      url:
        MINTCHAIN_API_URL,
      crop_id,
      walletAddress:
        wallet,
      metadataURI
    });

    const mintRes = await fetch(
      MINTCHAIN_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },
        body: JSON.stringify({
          metadataURI,
          crop_id,
          walletAddress:
            wallet,
          wallet
        })
      }
    );

    const mintParsed =
      await safeJson(mintRes);

    if (!mintParsed.ok) {
      log("MINT_INVALID_JSON", {
        status:
          mintRes.status,
        raw:
          mintParsed.raw?.slice(
            0,
            1000
          )
      });

      return res.status(500).json({
        ok: false,
        success: false,
        error:
          "Mint API nevrátilo validný JSON",
        status:
          mintRes.status,
        raw:
          mintParsed.raw
      });
    }

    const mintJson =
      mintParsed.json;

    log("MINT_RESPONSE", {
      status:
        mintRes.status,
      response:
        mintJson
    });

    if (!mintRes.ok) {
      return res.status(500).json({
        ok: false,
        success: false,
        error:
          mintJson?.error ||
          "Mint API vrátilo chybu",
        status:
          mintRes.status,
        detail:
          mintJson
      });
    }

    const txHash =
      mintJson.txHash ||
      mintJson.tx ||
      mintJson.transactionHash ||
      null;

    const mintOk =
      mintJson.ok === true ||
      mintJson.success === true ||
      Boolean(txHash);

    if (
      !mintOk ||
      !txHash
    ) {
      return res.status(500).json({
        ok: false,
        success: false,
        error:
          "Mintovanie zlyhalo",
        detail:
          mintJson
      });
    }

    const tokenId =
      mintJson.tokenId ??
      mintJson.token_id ??
      mintJson.id ??
      null;

    if (
      tokenId === null ||
      tokenId === undefined ||
      tokenId === ""
    ) {
      return res.status(500).json({
        ok: false,
        success: false,
        error:
          "Mint prebehol, ale chýba tokenId",
        txHash,
        detail:
          mintJson
      });
    }

    const tokenIdStr =
      String(tokenId);

    const openseaUrl =
      mintJson.openseaUrl ||
      `https://opensea.io/assets/base/${CONTRACT}/${tokenIdStr}`;

    const copyMintUrl =
      `https://chainvers.free.nf/copymint.php?original_id=${encodeURIComponent(
        tokenIdStr
      )}&contract=${encodeURIComponent(
        CONTRACT
      )}`;

    log("SUCCESS_FAST_RESPONSE", {
      txHash,
      tokenId:
        tokenIdStr,
      contractAddress:
        CONTRACT,
      openseaUrl,
      copyMintUrl
    });

    return res.status(200).json({
      ok: true,
      success: true,
      message:
        "NFT úspešne vytvorený",

      metadata_cid:
        metadataCID,

      metadataURI,

      image_cid:
        imageCID,

      imageURI,

      txHash,

      contractAddress:
        CONTRACT,

      tokenId:
        tokenIdStr,

      token_id:
        tokenIdStr,

      cropId:
        crop_id,

      crop_id,

      openseaUrl,

      copyMintUrl
    });

  } catch (err) {
    console.error(
      "CHAINWEBHOOK ERROR:",
      err
    );

    return res.status(500).json({
      ok: false,
      success: false,
      error:
        "Interná chyba servera",
      detail:
        err?.message ||
        String(err),
      stack:
        err?.stack ||
        null
    });
  }
}