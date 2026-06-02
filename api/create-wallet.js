// ============================================
// FILE: /api/create-wallet.js
// ============================================

import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";

const walletCache = globalThis.__CHAINVERS_WALLET_CACHE__ || new Map();
globalThis.__CHAINVERS_WALLET_CACHE__ = walletCache;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://chainvers.free.nf");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.COINBASE_API_KEY || !process.env.COINBASE_API_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Missing COINBASE_API_KEY or COINBASE_API_SECRET"
      });
    }

    const email = normalizeEmail(req.body?.email);
    const cacheKey = email || `ip:${req.headers["x-forwarded-for"] || "unknown"}`;

    if (walletCache.has(cacheKey)) {
      return res.status(200).json({
        ok: true,
        address: walletCache.get(cacheKey),
        network: "base-mainnet",
        cached: true
      });
    }

    Coinbase.configure({
      apiKeyName: process.env.COINBASE_API_KEY,
      privateKey: process.env.COINBASE_API_SECRET
    });

    const wallet = await Wallet.create({
      networkId: "base-mainnet"
    });

    const address = await wallet.createAddress();
    const addressId = address.getId();

    walletCache.set(cacheKey, addressId);

    return res.status(200).json({
      ok: true,
      address: addressId,
      network: "base-mainnet",
      cached: false
    });

  } catch (e) {
    console.error("CREATE WALLET ERROR:", e);

    if (e?.httpCode === 429 || e?.apiCode === "resource_exhausted") {
      return res.status(429).json({
        ok: false,
        error: "Coinbase limit: skús to znova o chvíľu. API už funguje, len je dočasne obmedzené."
      });
    }

    return res.status(400).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}