// ============================================
// FILE: /api/create-wallet.js
// ============================================

import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";
import { ethers } from "ethers";

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
      network: "base-mainnet",
      provider: "coinbase"
    });

  } catch (e) {
    console.error("CREATE WALLET ERROR:", e);

    if (e?.httpCode === 429 || e?.apiCode === "resource_exhausted") {
      const fallbackWallet = ethers.Wallet.createRandom();

      return res.status(200).json({
        ok: true,
        address: fallbackWallet.address,
        privateKey: fallbackWallet.privateKey,
        mnemonic: fallbackWallet.mnemonic?.phrase || "",
        network: "base-mainnet",
        provider: "local-fallback",
        warning: "Coinbase limit bol prekročený. Bola vytvorená lokálna EVM peňaženka. Recovery phrase a private key si bezpečne ulož."
      });
    }

    return res.status(400).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}