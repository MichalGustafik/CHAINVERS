// pages/api/circle_buy_eth.js
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`, "Content-Type": "application/json" };

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
    await postLog("CIRCLE.START", { eurAmount: amountStr });

    // 1) PaymentIntent (EUR → USDC)
    const piBody = {
      idempotencyKey: uuid(),
      amount: { amount: amountStr, currency: "EUR" },
      paymentMethod: { type: "card", id: process.env.CIRCLE_CARD_ID },
      settlementCurrency: "USDC",
      description: "CHAINVERS auto top-up",
    };
    const piRes = await fetch(`${CIRCLE_BASE}/v1/paymentIntents`, { method: "POST", headers: HDRS, body: JSON.stringify(piBody) });
    const piTxt = await piRes.text(); const piJson = safeJson(piTxt);
    if (!piRes.ok) { await postLog("CIRCLE.PAYMENTINTENT.ERROR", { status: piRes.status, body: piTxt }); return res.status(piRes.status).json({ ok:false, stage:"paymentIntent", error: piJson || piTxt }); }
    const intentId = piJson?.data?.id;
    await postLog("CIRCLE.PAYMENTINTENT", { intentId });

    await sleep(3000); // short settle

    // 2) Payout USDC → Base
    const poBody = {
      idempotencyKey: uuid(),
      destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
      amount: { amount: amountStr, currency: "USDC" },
      chain: process.env.PAYOUT_CHAIN || "BASE",
    };
    const poRes = await fetch(`${CIRCLE_BASE}/v1/payouts`, { method: "POST", headers: HDRS, body: JSON.stringify(poBody) });
    const poTxt = await poRes.text(); const poJson = safeJson(poTxt);
    if (!poRes.ok) { await postLog("CIRCLE.PAYOUT.ERROR", { status: poRes.status, body: poTxt }); return res.status(poRes.status).json({ ok:false, stage:"payoutCreate", error: poJson || poTxt }); }
    const payoutId = poJson?.data?.id;
    await postLog("CIRCLE.PAYOUT.CREATED", { payoutId, amount: amountStr });

    // 3) Polling
    const pollMs = Number(process.env.CIRCLE_POLL_INTERVAL_MS || "3000");
    const maxMs  = Number(process.env.CIRCLE_POLL_TIMEOUT_MS  || "90000");
    const final = await pollPayout(payoutId, pollMs, maxMs);

    await postLog("CIRCLE.PAYOUT.FINAL", final);
    return res.status(200).json({ ok: true, intentId, payoutId, finalStatus: final?.status || "unknown", raw: final });

  } catch (e) {
    await postLog("CIRCLE.ERROR", { error: e?.message || String(e) });
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// helpers
function uuid(){ if(globalThis.crypto?.randomUUID) return crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=(Math.random()*16)|0,v=c==="x"?r:(r&0x3)|0x8;return v.toString(16);});}
function safeJson(t){ try{return JSON.parse(t);}catch{return null;} }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function pollPayout(payoutId, intervalMs, timeoutMs) {
  const start = Date.now();
  while (true) {
    const r = await fetch(`${CIRCLE_BASE}/v1/payouts/${payoutId}`, { headers: HDRS });
    const t = await r.text(); const j = safeJson(t) || {};
    const st = (j?.data?.status || j?.status || "").toLowerCase();
    await postLog("CIRCLE.POLL.UPDATE", { payoutId, status: st });

    if (["paid","complete","completed","confirmed","succeeded","success"].includes(st)) return j?.data || j;
    if (["failed","rejected","canceled","cancelled","error"].includes(st)) return j?.data || j;
    if (Date.now() - start > timeoutMs) return { status:"timeout", raw:j };

    await sleep(intervalMs);
  }
}

async function postLog(stage, data) {
  try {
    const baseURL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    if (!baseURL) return;
    await fetch(`${baseURL}/api/chainpospaidlog`, {
      method: "POST", headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ userId:"anon", sessionId:"", stage, data })
    });
  } catch {}
}