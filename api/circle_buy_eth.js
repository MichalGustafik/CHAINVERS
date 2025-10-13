// pages/api/circle_buy_eth.js
// EUR z karty (Circle) → settlement USDC → payout na Base (bez pollingu)

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

    // IDs z ENV (získané raz cez API/Dashboard a uložené)
    const cardId = process.env.CIRCLE_CARD_ID;              // napr. card_abc...
    const addrId = process.env.CIRCLE_ADDRESS_BOOK_ID;      // napr. adr_abc...
    if (!cardId)  return res.status(500).json({ error: "Missing CIRCLE_CARD_ID (set in ENV)" });
    if (!addrId)  return res.status(500).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID (set in ENV)" });

    const amountStr = String(Number(eurAmount).toFixed(2));

    // 1) PaymentIntent (EUR z karty → USDC)
    const piBody = {
      idempotencyKey: uuid(),
      amount: { amount: amountStr, currency: "EUR" },
      paymentMethod: { type: "card", id: cardId },
      settlementCurrency: "USDC",
      description: "CHAINVERS auto top-up",
    };
    const piRes = await fetch(`${CIRCLE_BASE}/v1/paymentIntents`, {
      method: "POST", headers: HDRS, body: JSON.stringify(piBody),
    });
    const piTxt = await piRes.text(); const piJson = safeJson(piTxt);
    if (!piRes.ok) {
      return res.status(piRes.status).json({ ok:false, stage:"paymentIntent", error: piJson || piTxt });
    }
    const intentId = piJson?.data?.id;

    // 2) Payout (USDC) → Base recipient (Address Book ID)
    const poBody = {
      idempotencyKey: uuid(),
      destination: { type: "address_book", id: addrId },
      amount: { amount: amountStr, currency: "USDC" },
      chain: process.env.PAYOUT_CHAIN || "BASE",
    };
    const poRes = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST", headers: HDRS, body: JSON.stringify(poBody),
    });
    const poTxt = await poRes.text(); const poJson = safeJson(poTxt);
    if (!poRes.ok) {
      return res.status(poRes.status).json({ ok:false, stage:"payoutCreate", error: poJson || poTxt });
    }

    // Bez pollingu: vráť ID payoutu a status z create odpovede
    const payoutId = poJson?.data?.id;
    const status   = poJson?.data?.status;

    return res.status(200).json({
      ok: true,
      intentId,
      payoutId,
      status,     // typicky "pending"/"initialized" – bez pollingu ho nesledujeme
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// helpers
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random()*16)|0, v = c==="x" ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}
function safeJson(t){ try{ return JSON.parse(t); } catch { return null; } }