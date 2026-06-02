// ============================================
// FILE: /api/create-wallet.js
// ============================================

import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {

    Coinbase.configure({
      apiKeyName: process.env.COINBASE_API_KEY,
      privateKey: process.env.COINBASE_API_SECRET,
    });

    const wallet = await Wallet.create({
      networkId: "base-mainnet"
    });

    const address = await wallet.createAddress();

    return res.status(200).json({
      ok: true,
      address: address.getId()
    });

  } catch (e) {

    return res.status(500).json({
      ok: false,
      error: String(e)
    });

  }

}