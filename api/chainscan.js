console.log("=== BOOT: CHAINVERS /api/chainscan DEBUG ===");

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

function ipfsToHttp(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + uri.replace("ipfs://", "").replace(/^ipfs\//, "");
  }
  return uri;
}

async function fetchMetadata(tokenURI, logs) {
  try {
    const url = ipfsToHttp(tokenURI);
    logPush(logs, "FETCH_METADATA_URL", { url });

    if (!/^https?:\/\//i.test(url)) return null;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json,text/plain,*/*" }
    });

    clearTimeout(timeout);

    logPush(logs, "METADATA_HTTP", { status: r.status, ok: r.ok });

    if (!r.ok) return null;

    const txt = await r.text();

    try {
      return JSON.parse(txt);
    } catch {
      return { raw: txt.slice(0, 500) };
    }
  } catch (e) {
    logPush(logs, "METADATA_ERROR", { error: e.message });
    return null;
  }
}

async function getProvider(logs) {
  let lastErr = null;

  for (const rpc of BASE_RPCS) {
    try {
      logPush(logs, "TRY_RPC", { rpc });
      const provider = new ethers.JsonRpcProvider(rpc);
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

    if (!ethers.isAddress(contract)) {
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

    try {
      logPush(logs, "CALL_TOKEN_URI", { tokenId });
      tokenURI = await nft.tokenURI(tokenId);
      logPush(logs, "TOKEN_URI_OK", { tokenURI });
      metadata = await fetchMetadata(tokenURI, logs);
    } catch (e) {
      logPush(logs, "TOKEN_URI_FAIL", { error: e.message });
    }

    let originalOf = "0";
    let type = "origin";

    try {
      logPush(logs, "CALL_COPY_TO_ORIGINAL", { tokenId });
      originalOf = (await nft.copyToOriginal(tokenId)).toString();
      if (originalOf !== "0") type = "copy";
      logPush(logs, "COPY_TO_ORIGINAL_OK", { originalOf, type });
    } catch (e) {
      logPush(logs, "COPY_TO_ORIGINAL_FAIL_ASSUME_ORIGIN", { error: e.message });
    }

    let userHasCopy = false;

    if (wallet && ethers.isAddress(wallet)) {
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

    const image = ipfsToHttp(
      metadata?.image ||
      metadata?.image_url ||
      metadata?.animation_url ||
      ""
    );

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
      image,
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