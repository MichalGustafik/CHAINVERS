console.log("=== BOOT: CHAINVERS /api/chainscan ===");

import { ethers } from "ethers";

export const config = {
  api: {
    bodyParser: true
  }
};

const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || "").toLowerCase();

const BASE_RPCS = [
  process.env.PROVIDER_URL,
  process.env.BASE_RPC_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base.publicnode.com"
].filter(Boolean);

const ABI = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "copyToOriginal",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" }
    ],
    name: "hasCopy",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  }
];

function json(res, status, data) {
  res.status(status).json(data);
}

function normalizeAddress(addr) {
  if (!addr) return "";
  return String(addr).trim().toLowerCase();
}

function isValidTokenId(tokenId) {
  return /^\d+$/.test(String(tokenId || ""));
}

function ipfsToHttp(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + uri.replace("ipfs://", "").replace(/^ipfs\//, "");
  }
  return uri;
}

async function fetchMetadata(tokenURI) {
  try {
    const url = ipfsToHttp(tokenURI);
    if (!url || !/^https?:\/\//i.test(url)) return null;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const r = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json,text/plain,*/*" }
    });

    clearTimeout(timeout);

    if (!r.ok) return null;

    const txt = await r.text();

    try {
      return JSON.parse(txt);
    } catch {
      return { raw: txt.slice(0, 500) };
    }
  } catch {
    return null;
  }
}

async function getProvider() {
  let lastErr = null;

  for (const rpc of BASE_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      return { provider, rpc };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error("No working Base RPC. Last error: " + (lastErr?.message || "unknown"));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    if (!CONTRACT_ADDRESS || !ethers.isAddress(CONTRACT_ADDRESS)) {
      return json(res, 500, {
        ok: false,
        is_chainvers: false,
        error: "Missing or invalid CONTRACT_ADDRESS in Vercel Environment Variables"
      });
    }

    const body = req.body || {};

    const chain = String(body.chain || "base").toLowerCase().trim();
    const contract = normalizeAddress(body.contract);
    const tokenId = String(body.token_id || body.token || "").trim();
    const wallet = normalizeAddress(body.wallet || body.user || body.user_address || "");

    if (chain !== "base") {
      return json(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Unsupported chain",
        chain
      });
    }

    if (!ethers.isAddress(contract)) {
      return json(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Invalid contract address",
        contract
      });
    }

    if (!isValidTokenId(tokenId)) {
      return json(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Invalid token id",
        token_id: tokenId
      });
    }

    if (contract !== CONTRACT_ADDRESS) {
      return json(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Not CHAINVERS contract",
        contract,
        expected_contract: CONTRACT_ADDRESS,
        token_id: tokenId
      });
    }

    const { provider, rpc } = await getProvider();
    const nft = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

    let owner = "";
    let tokenURI = "";
    let metadata = null;

    try {
      owner = await nft.ownerOf(tokenId);
    } catch (e) {
      return json(res, 200, {
        ok: false,
        is_chainvers: true,
        exists: false,
        error: "Token does not exist or ownerOf failed",
        details: e.message,
        contract,
        token_id: tokenId
      });
    }

    try {
      tokenURI = await nft.tokenURI(tokenId);
      metadata = await fetchMetadata(tokenURI);
    } catch {
      tokenURI = "";
      metadata = null;
    }

    let originalOf = "0";
    let type = "origin";

    try {
      originalOf = (await nft.copyToOriginal(tokenId)).toString();
      if (originalOf !== "0") type = "copy";
    } catch {
      originalOf = "0";
      type = "origin";
    }

    let userHasCopy = false;

    if (wallet && ethers.isAddress(wallet)) {
      try {
        userHasCopy = await nft.hasCopy(tokenId, wallet);
      } catch {
        userHasCopy = false;
      }
    }

    const image = ipfsToHttp(
      metadata?.image ||
      metadata?.image_url ||
      metadata?.animation_url ||
      ""
    );

    return json(res, 200, {
      ok: true,
      is_chainvers: true,
      exists: true,
      chain,
      contract,
      token_id: tokenId,
      owner,
      token_uri: tokenURI,
      metadata,
      image,
      type,
      original_of: originalOf,
      can_copymint: type === "origin" && !userHasCopy,
      user_has_copy: userHasCopy,
      rpc_used: rpc
    });

  } catch (e) {
    return json(res, 500, {
      ok: false,
      is_chainvers: false,
      error: e.message || String(e)
    });
  }
}