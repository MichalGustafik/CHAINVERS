// pages/api/circle_payout.js
// Automaticky spúšťané po úspešnej Stripe platbe.
// Používa len CIRCLE_API_KEY, CIRCLE_BASE, PAYOUT_CHAIN (+ CONTRACT_ADDRESS).

const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    const chain = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
    const contract = process.env.CONTRACT_ADDRESS;

    if (!apiKey) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
    if (!contract) return res.status(400).json({ error: "Missing CONTRACT_ADDRESS" });

    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const { amount, currency = "USDC" } = body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ error: "Missing or invalid amount" });

    const idempotencyKey = uuid();
    const payload = {
      idempotencyKey,
      destination: { type: "crypto", address: contract },
      amount: { amount: String(amount), currency },
      chain,
    };

    await postLog("CIRCLE.PAYOUT.START", { chain, amount, currency, contract });

    const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST",
      headers: HDRS(apiKey),
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!r.ok) {
      await postLog("CIRCLE.PAYOUT.ERROR", { status: r.status, text });
      return res.status(r.status).json({ ok: false, error: json || text });
    }

    const data = json?.data || {};
    await postLog("CIRCLE.PAYOUT.SUCCESS", { payoutId: data.id, status: data.status });

    return res.status(200).json({
      ok: true,
      payoutId: data.id,
      status: data.status,
      chain: data.chain,
      amount: data.amount,
      destination: data.destination,
    });
  } catch (e) {
    await postLog("CIRCLE.PAYOUT.FATAL", { error: e?.message || String(e) });
    return res.status(500).json({ error: e.message || String(e) });
  }
}

// helpers
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function postLog(stage, data) {
  try {
    const baseURL =
      process.env.BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (!baseURL) return;
    await fetch(`${baseURL}/api/chainpospaidlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "anon",
        sessionId: "",
        stage,
        data,
      }),
    });
  } catch {}
}