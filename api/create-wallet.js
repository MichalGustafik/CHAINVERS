// ============================================
// FILE: /api/create-wallet.js
// ============================================

import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://chainvers.free.nf");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

    Coinbase.configure({
      apiKeyName: process.env.COINBASE_API_KEY,
      privateKey: process.env.COINBASE_API_SECRET
    });

    const wallet = await Wallet.create({
      networkId: "base-mainnet"
    });

    const address = await wallet.createAddress();

    return res.status(200).json({
      ok: true,
      address: address.getId(),
      network: "base-mainnet"
    });

  } catch (e) {
    console.error("CREATE WALLET ERROR:", e);

    if (e?.httpCode === 429 || e?.apiCode === "resource_exhausted") {
      return res.status(429).json({
        ok: false,
        error: "Coinbase limit: skús to znova o chvíľu."
      });
    }

    return res.status(400).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}