console.log("=== BOOT: CHAINVERS /api/chainscan DEBUG ETHERS V5 ===");

import { ethers } from "ethers";

export const config = {
  api: { bodyParser: true }
};

const DEBUG = true;

function logPush(logs, msg, data = null) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line, data || "");
  logs.push(data ? `${line} ${JSON.stringify(data)}` : line);
}

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

const CHAINVERS_CONTRACTS = [
  ...envList("CHAINVERS_CONTRACTS"),
  String(process.env.CONTRACT_ADDRESS || "").trim().toLowerCase()
].filter(Boolean);

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

function response(res, status, data, logs) {
  return res.status(status).json({
    ...data,
    debug_log: DEBUG ? logs : undefined
  });
}

function norm(v) {
  return String(v || "").trim().toLowerCase();
}

function isValidTokenId(v) {
  return /^\d+$/.test(String(v || ""));
}

function isAddress(addr) {
  return ethers.utils && ethers.utils.isAddress(addr);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function decodeDataJson(uri) {
  const value = String(uri || "").trim();
  if (!/^data:application\/json/i.test(value)) return null;
  try {
    const comma = value.indexOf(",");
    if (comma < 0) return null;
    const header = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    const text = /;base64/i.test(header)
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resourceCandidates(uri, baseUrl = "") {
  const raw = String(uri || "").trim();
  if (!raw) return [];
  if (/^data:/i.test(raw) || /^blob:/i.test(raw)) return [raw];
  if (/^ar:\/\//i.test(raw)) return ["https://arweave.net/" + raw.replace(/^ar:\/\//i, "")];

  if (/^ipfs:\/\//i.test(raw)) {
    const cidPath = raw.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
    return unique([
      `https://gateway.pinata.cloud/ipfs/${cidPath}`,
      `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
      `https://ipfs.io/ipfs/${cidPath}`
    ]);
  }

  if (/^https?:\/\//i.test(raw)) {
    const out = [raw];
    try {
      const u = new URL(raw);
      const marker = "/ipfs/";
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        const cidPath = u.pathname.slice(idx + marker.length) + u.search;
        out.push(
          `https://gateway.pinata.cloud/ipfs/${cidPath}`,
          `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
          `https://ipfs.io/ipfs/${cidPath}`
        );
      }
    } catch {}
    return unique(out);
  }

  if (baseUrl && /^https?:\/\//i.test(baseUrl)) {
    try { return [new URL(raw, baseUrl).toString()]; } catch {}
  }
  return [raw];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchMetadata(tokenURI, logs) {
  const inline = decodeDataJson(tokenURI);
  if (inline) {
    logPush(logs, "METADATA_INLINE_JSON");
    return { metadata: inline, metadataUrl: String(tokenURI || ""), tried: [String(tokenURI || "")] };
  }

  const tried = [];
  for (const url of resourceCandidates(tokenURI)) {
    if (!/^https?:\/\//i.test(url)) continue;
    tried.push(url);
    try {
      logPush(logs, "FETCH_METADATA_URL", { url });
      const r = await fetchWithTimeout(url, {
        headers: { Accept: "application/json,text/plain,*/*", "User-Agent": "CHAINVERS/1.0" },
        cache: "no-store"
      });
      logPush(logs, "METADATA_HTTP", { url, status: r.status, ok: r.ok });
      if (!r.ok) continue;
      const txt = await r.text();
      try {
        return { metadata: JSON.parse(txt), metadataUrl: url, tried };
      } catch {
        logPush(logs, "METADATA_BAD_JSON", { url });
      }
    } catch (e) {
      logPush(logs, "METADATA_ERROR", { url, error: e.message });
    }
  }
  return { metadata: null, metadataUrl: "", tried };
}

function collectImageValues(metadata) {
  if (!metadata || typeof metadata !== "object") return [];
  const values = [];
  const add = value => { if (typeof value === "string" && value.trim()) values.push(value.trim()); };
  add(metadata.image);
  add(metadata.image_url);
  add(metadata.imageUrl);
  add(metadata.imageURI);
  add(metadata.image_uri);
  add(metadata.animation_url);
  add(metadata.animationUrl);
  add(metadata.thumbnail);
  add(metadata.thumbnail_url);
  add(metadata?.properties?.image);
  add(metadata?.properties?.image_url);
  add(metadata?.properties?.files?.[0]?.uri);
  add(metadata?.properties?.files?.[0]?.url);
  add(metadata?.media?.[0]?.uri);
  add(metadata?.media?.[0]?.url);
  add(metadata?.files?.[0]?.uri);
  add(metadata?.files?.[0]?.url);
  return unique(values);
}

function imageCandidatesFromMetadata(metadata, metadataUrl = "") {
  const out = [];
  for (const value of collectImageValues(metadata)) out.push(...resourceCandidates(value, metadataUrl));
  return unique(out);
}

async function getProvider(logs) {
  let lastErr = null;

  for (const rpc of BASE_RPCS) {
    try {
      logPush(logs, "TRY_RPC", { rpc });

      const provider = new ethers.providers.JsonRpcProvider(rpc);
      const block = await provider.getBlockNumber();

      logPush(logs, "RPC_OK", { rpc, block });

      return { provider, rpc };
    } catch (e) {
      lastErr = e;
      logPush(logs, "RPC_FAIL", { rpc, error: e.message });
    }
  }

  throw new Error("No working Base RPC: " + (lastErr?.message || "unknown"));
}

export default async function handler(req, res) {
  const logs = [];

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  logPush(logs, "REQUEST_START", {
    method: req.method,
    url: req.url,
    contracts_loaded: CHAINVERS_CONTRACTS.length,
    contracts: CHAINVERS_CONTRACTS,
    provider_url_exists: !!process.env.PROVIDER_URL,
    base_rpc_exists: !!process.env.BASE_RPC_URL
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    const qContract = req.query.contract;
    const qToken = req.query.token_id || req.query.token;

    if (qContract && qToken) {
      req.method = "POST";
      req.body = {
        chain: req.query.chain || "base",
        contract: qContract,
        token_id: qToken,
        wallet: req.query.wallet || ""
      };
      logPush(logs, "GET_TEST_MODE_AS_POST", req.body);
    } else {
      return response(res, 200, {
        ok: true,
        endpoint: "/api/chainscan",
        message: "Use POST with chain, contract, token_id.",
        contracts_loaded: CHAINVERS_CONTRACTS.length,
        contracts: CHAINVERS_CONTRACTS
      }, logs);
    }
  }

  if (req.method !== "POST") {
    return response(res, 405, {
      ok: false,
      error: "Method not allowed"
    }, logs);
  }

  try {
    if (!CHAINVERS_CONTRACTS.length) {
      return response(res, 500, {
        ok: false,
        is_chainvers: false,
        error: "Missing CONTRACT_ADDRESS or CHAINVERS_CONTRACTS in Vercel Environment Variables"
      }, logs);
    }

    const body = req.body || {};
    logPush(logs, "RAW_BODY", body);

    const chain = String(body.chain || "base").toLowerCase().trim();
    const contract = norm(body.contract);
    const tokenId = String(body.token_id || body.token || "").trim();
    const wallet = norm(body.wallet || body.user || body.user_address || "");

    logPush(logs, "PARSED_INPUT", {
      chain,
      contract,
      tokenId,
      wallet
    });

    if (chain !== "base") {
      return response(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Unsupported chain",
        chain
      }, logs);
    }

    if (!isAddress(contract)) {
      return response(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Invalid contract address",
        contract
      }, logs);
    }

    if (!isValidTokenId(tokenId)) {
      return response(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Invalid token id",
        token_id: tokenId
      }, logs);
    }

    logPush(logs, "CONTRACT_COMPARE", {
      received: contract,
      expected: CHAINVERS_CONTRACTS,
      match: CHAINVERS_CONTRACTS.includes(contract)
    });

    if (!CHAINVERS_CONTRACTS.includes(contract)) {
      return response(res, 200, {
        ok: false,
        is_chainvers: false,
        error: "Not CHAINVERS contract",
        contract,
        expected_contracts: CHAINVERS_CONTRACTS,
        token_id: tokenId
      }, logs);
    }

    const { provider, rpc } = await getProvider(logs);
    const nft = new ethers.Contract(contract, ABI, provider);

    let owner = "";

    try {
      logPush(logs, "CALL_OWNER_OF", { tokenId });
      owner = await nft.ownerOf(tokenId);
      logPush(logs, "OWNER_OF_OK", { owner });
    } catch (e) {
      logPush(logs, "OWNER_OF_FAIL", { error: e.message });

      return response(res, 200, {
        ok: false,
        is_chainvers: true,
        exists: false,
        error: "Token does not exist or ownerOf failed",
        details: e.message,
        contract,
        token_id: tokenId
      }, logs);
    }

    let tokenURI = "";
    let metadata = null;
    let metadataResolvedUrl = "";
    let metadataTried = [];

    try {
      logPush(logs, "CALL_TOKEN_URI", { tokenId });
      tokenURI = await nft.tokenURI(tokenId);
      logPush(logs, "TOKEN_URI_OK", { tokenURI });
      const fetched = await fetchMetadata(tokenURI, logs);
      metadata = fetched.metadata;
      metadataResolvedUrl = fetched.metadataUrl || "";
      metadataTried = fetched.tried || [];
    } catch (e) {
      logPush(logs, "TOKEN_URI_FAIL", { error: e.message });
    }

    let originalOf = "0";
    let type = "origin";

    try {
      logPush(logs, "CALL_COPY_TO_ORIGINAL", { tokenId });
      originalOf = (await nft.copyToOriginal(tokenId)).toString();

      if (originalOf !== "0") {
        type = "copy";
      }

      logPush(logs, "COPY_TO_ORIGINAL_OK", { originalOf, type });
    } catch (e) {
      logPush(logs, "COPY_TO_ORIGINAL_FAIL_ASSUME_ORIGIN", {
        error: e.message
      });
    }

    let userHasCopy = false;

    if (wallet && isAddress(wallet)) {
      try {
        logPush(logs, "CALL_HAS_COPY", { tokenId, wallet });
        userHasCopy = await nft.hasCopy(tokenId, wallet);
        logPush(logs, "HAS_COPY_OK", { userHasCopy });
      } catch (e) {
        logPush(logs, "HAS_COPY_FAIL", { error: e.message });
      }
    } else {
      logPush(logs, "SKIP_HAS_COPY_NO_VALID_WALLET");
    }

    const imageCandidates = imageCandidatesFromMetadata(metadata, metadataResolvedUrl);
    const image = imageCandidates[0] || "";

    return response(res, 200, {
      ok: true,
      is_chainvers: true,
      exists: true,
      chain,
      contract,
      token_id: tokenId,
      owner,
      token_uri: tokenURI,
      metadata,
      metadata_resolved_url: metadataResolvedUrl,
      metadata_candidates_tried: metadataTried,
      image,
      image_candidates: imageCandidates,
      type,
      original_of: originalOf,
      can_copymint: type === "origin" && !userHasCopy,
      user_has_copy: userHasCopy,
      rpc_used: rpc
    }, logs);

  } catch (e) {
    logPush(logs, "HANDLER_FATAL", {
      error: e.message,
      stack: e.stack
    });

    return response(res, 500, {
      ok: false,
      is_chainvers: false,
      error: e.message || String(e)
    }, logs);
  }
}