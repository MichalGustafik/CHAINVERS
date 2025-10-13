// pages/api/circle_payout.js
// Circle payout priamo na kontrakt bez Address Booku a pollingu.
// ENV: CIRCLE_API_KEY, CIRCLE_BASE, PAYOUT_CHAIN, CONTRACT_ADDRESS

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const chain = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
    if (!apiKey)
      return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });

    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
    }

    const { amount, currency = "USDC", to } = body;
    const address = to || process.env.CONTRACT_ADDRESS;
    if (!amount || !address)
      return res
        .status(400)
        .json({ error: "Missing amount or contract address (to)" });

    const idempotencyKey = uuid();
    const payload = {
      idempotencyKey,
      destination: { type: "crypto", address },
      amount: { amount: String(amount), currency },
      chain,
    };

    const r = await fetch(`${base}/v1/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!r.ok)
      return res
        .status(r.status)
        .json({ ok: false, error: json || text || "Circle API error" });

    const data = json?.data || json;
    console.log("[CIRCLE_PAYOUT] ✅", data);

    return res.status(200).json({
      ok: true,
      payoutId: data?.id,
      status: data?.status,
      chain: data?.chain,
      amount: data?.amount,
      destination: data?.destination,
    });
  } catch (e) {
    console.error("[CIRCLE_PAYOUT] ERROR", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

// helper
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}