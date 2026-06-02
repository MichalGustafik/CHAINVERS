// ============================================
// FILE: /api/create-wallet.js
// ============================================

import { CdpClient } from "@coinbase/cdp-sdk";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const cdp = new CdpClient({
      apiKeyId: process.env.COINBASE_API_KEY,
      apiKeySecret: process.env.COINBASE_API_SECRET,
      walletSecret: process.env.CDP_WALLET_SECRET
    });

    const account = await cdp.evm.createServerAccount({
      network: "base-mainnet"
    });

    return res.status(200).json({
      ok: true,
      address: account.address,
      network: "base-mainnet"
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err)
    });
  }
}