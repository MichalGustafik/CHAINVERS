// pages/api/circle_buy_eth.js
// Po Stripe platbe: EUR z karty (Circle) → USDC → payout na Base (address book)
// Obsahuje polling payoutu.

const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const { eurAmount } = body || {};
    if (!eurAmount || Number(eurAmount) <= 0) return res.status(400).json({ error: "Missing eurAmount > 0" });
    if (!process.env.CIRCLE_CARD_ID) return res.status(500).json({ error: "Missing CIRCLE_CARD_ID" });
    if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(500).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID" });

    const amountStr = String(Number(eurAmount).toFixed(2));
    console.log("[CIRCLE] 💳 Start", { eurAmount: amountStr });

    // 1) PaymentIntent (EUR → USDC)
    const piBody = {
      idempotencyKey: uuid(),
      amount: { amount: amountStr, currency: "EUR" },
      paymentMethod: { type: "card", id: process.env.CIRCLE_CARD_ID },
      settlementCurrency: "USDC",
      description: "CHAINVERS auto top-up",
    };

    const piRes = await fetch(`${CIRCLE_BASE}/v1/paymentIntents`, {
      method: "POST", headers: HDRS, body: JSON.stringify(piBody),
    });
    const piTxt = await piRes.text(); let piJson = safeJson(piTxt);
    if (!piRes.ok) return res.status(piRes.status).json({ ok:false, stage:"paymentIntent", error: piJson || piTxt });
    const intentId = piJson?.data?.id;
    console.log("[CIRCLE] ✅ PaymentIntent", { intentId });

    // krátke čakanie (alebo tu môžeš doplniť polling intentu)
    await sleep(3000);

    // 2) Payout USDC → Base (address book recipient)
    const poBody = {
      idempotencyKey: uuid(),
      destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
      amount: { amount: amountStr, currency: "USDC" },
      chain: process.env.PAYOUT_CHAIN || "BASE",
    };

    const poRes = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST", headers: HDRS, body: JSON.stringify(poBody),
    });
    const poTxt = await poRes.text(); let poJson = safeJson(poTxt);
    if (!poRes.ok) return res.status(poRes.status).json({ ok:false, stage:"payoutCreate", error: poJson || poTxt });

    const payoutId = poJson?.data?.id;
    console.log("[CIRCLE] ✅ Payout created", { payoutId });

    // 3) POLLING stavu payoutu
    const pollMs = Number(process.env.CIRCLE_POLL_INTERVAL_MS || "3000");   // 3s
    const maxMs  = Number(process.env.CIRCLE_POLL_TIMEOUT_MS  || "90000");  // 90s
    const final = await pollPayout(payoutId, pollMs, maxMs);

    console.log("[CIRCLE] 🏁 Payout final", final);

    return res.status(200).json({
      ok: true,
      intentId,
      payoutId,
      finalStatus: final?.status || "unknown",
      raw: final,
    });

  } catch (e) {
    console.error("[CIRCLE] ❌ Error", e?.message);
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// ---------- helpers ----------
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function safeJson(txt) { try { return JSON.parse(txt); } catch { return null; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollPayout(payoutId, intervalMs, timeoutMs) {
  const start = Date.now();
  while (true) {
    const r = await fetch(`${CIRCLE_BASE}/v1/payouts/${payoutId}`, { headers: HDRS });
    const t = await r.text(); const j = safeJson(t) || {};
    const st = j?.data?.status || j?.status;
    console.log("[CIRCLE] ⏳ poll", { payoutId, status: st });

    // finálne / úspešné stavy (Circle môže používať rôzne: paid/complete/confirmed/succeeded)
    if (["paid","complete","completed","confirmed","succeeded","success"].includes(String(st).toLowerCase())) return j?.data || j;

    // neúspešné / terminal fail
    if (["failed","rejected","canceled","cancelled","error"].includes(String(st).toLowerCase())) return j?.data || j;

    if (Date.now() - start > timeoutMs) return { status: "timeout", raw: j };
    await sleep(intervalMs);
  }
}