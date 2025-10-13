// pages/api/chainvers.js
import Stripe from "stripe";
export const config = { api: { bodyParser: false } };

// --- ENV ---
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC  = process.env.STRIPE_WEBHOOK_SECRET;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const BASE_URL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

// --- jednoduchá in-memory “DB” (Vercel je efemérny → na produkciu použi Redis/KV/DB) ---
const PayoutDB = new Map(); // key: paymentIntentId, value: { payoutId, status, amount, currency, contract, updatedAt }

// --- router ---
export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();
  console.log("[CHAINVERS] ->", { method: req.method, action, url: req.url });

  try {
    if (action === "stripe_checkout")       return stripeCheckout(req, res);
    if (action === "create_payment_proxy")  return createPaymentProxy(req, res);
    if (action === "stripe_webhook")        return stripeWebhook(req, res);
    if (action === "circle_payout")         return circlePayout(req, res);
    if (action === "circle_payout_status")  return circlePayoutStatus(req, res); // ⬅️ nový
    if (action === "payout_status")         return payoutStatus(req, res);        // ⬅️ nový (podľa PI)
    if (action === "chainpospaidlog")       return chainPosPaidLog(req, res);
    if (action === "ping")                  return res.status(200).json({ ok:true, now:new Date().toISOString() });

    return res.status(400).json({ error: "Unknown ?action=", available: ["stripe_checkout","create_payment_proxy","stripe_webhook","circle_payout","circle_payout_status","payout_status","chainpospaidlog","ping"] });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ========== 1) STRIPE CHECKOUT ========== */
async function stripeCheckout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });
  if (!STRIPE_SECRET) return res.status(500).json({ error:"Missing STRIPE_SECRET_KEY" });
  const body = await readJsonBody(req);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "amount must be integer (cents)" });

  const stripe = new Stripe(STRIPE_SECRET);
  const currency = (body.currency || "eur").toLowerCase();
  const success_url = body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url  = body.cancel_url  || `${BASE_URL}/cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: { currency, product_data: { name: "CHAINVERS Order" }, unit_amount: amount },
      quantity: 1
    }],
    success_url, cancel_url,
    metadata: body.metadata || {}
  });
  return res.status(200).json({ id: session.id, url: session.url });
}

/* ========== 2) STRIPE CREATE (proxy pre obmedzené hostingy) ========== */
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });
  if (!STRIPE_SECRET) return res.status(500).json({ error:"Missing STRIPE_SECRET_KEY" });

  const body = await readJsonBody(req);
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url",  body.cancel_url  || `${BASE_URL}/cancel`);
  params.append("line_items[0][price_data][currency]", (body.currency || "eur").toLowerCase());
  params.append("line_items[0][price_data][product_data][name]", "CHAINVERS Order");
  params.append("line_items[0][price_data][unit_amount]", String(body.amount));
  params.append("line_items[0][quantity]", "1");
  for (const [k,v] of Object.entries(body.metadata || {})) {
    params.append(`metadata[${k}]`, typeof v === "string" ? v : JSON.stringify(v));
  }

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${STRIPE_SECRET}`, "Content-Type":"application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) return res.status(r.status).json({ error: j || txt });
  return res.status(200).json({ id: j.id, url: j.url });
}

/* ========== 3) STRIPE WEBHOOK (neblokuje) ========== */
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });
  if (!STRIPE_SECRET) return res.status(500).json({ error:"Missing STRIPE_SECRET_KEY" });

  const stripe = new Stripe(STRIPE_SECRET);
  const chunks = []; for await (const ch of req) chunks.push(ch);
  const rawBody = Buffer.concat(chunks);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WHSEC);
  } catch (err) {
    console.error("[stripeWebhook] bad signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const okTypes = new Set(["checkout.session.completed","checkout.session.async_payment_succeeded"]);
  if (!okTypes.has(event.type)) return res.status(200).json({ received:true });

  const s = event.data.object;
  const paymentIntentId = s.payment_intent;
  const amountPaid = (s.amount_total ?? 0) / 100;
  const currency   = (s.currency ?? "eur").toUpperCase();

  // 1) ulož “ticket” → Circle môže dobehnúť neskôr
  PayoutDB.set(paymentIntentId, {
    payoutId: null,
    status: "queued",            // queued → created → (pending/complete/failed)
    amount: Number(amountPaid.toFixed(2)),
    currency: "USDC",
    contract: CONTRACT_ADDRESS,
    updatedAt: Date.now(),
  });

  // 2) spusti payout (fire-and-forget)
  triggerCirclePayout({
    pi: paymentIntentId,
    amount: Number(amountPaid.toFixed(2)),
    currency: "USDC",
    to: CONTRACT_ADDRESS,
  }).catch((e) => console.error("[triggerCirclePayout] failed", e));

  // 3) webhook rýchlo skončí
  return res.status(200).json({ received:true });
}

/* ========== 4) CIRCLE PAYOUT (priame volanie) ========== */
async function circlePayout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });
  if (!CIRCLE_API_KEY) return res.status(500).json({ error:"Missing CIRCLE_API_KEY" });

  const body = await readJsonBody(req);
  const amount = body.amount;
  const currency = body.currency || "USDC";
  const address = body.to || CONTRACT_ADDRESS;
  const ref = body.ref || ""; // voliteľná referencia (napr. paymentIntentId)

  if (!address) return res.status(400).json({ error:"Missing CONTRACT_ADDRESS or body.to" });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error:"Missing/invalid amount" });

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address },
    amount: { amount: String(amount), currency },
    chain: PAYOUT_CHAIN,
  };

  const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CIRCLE_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}

  if (!r.ok) return res.status(r.status).json({ ok:false, error: j || txt });

  const data = j?.data || j;
  // ak prišlo ref (napr. paymentIntentId), ulož mapovanie
  if (ref) {
    const prev = PayoutDB.get(ref) || {};
    PayoutDB.set(ref, {
      ...prev,
      payoutId: data.id || prev.payoutId,
      status: data.status || "created",
      amount, currency, contract: address,
      updatedAt: Date.now(),
    });
  }
  return res.status(200).json({ ok:true, result: data });
}

/* ========== 5) CIRCLE PAYOUT STATUS (on-demand) ========== */
async function circlePayoutStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });
  if (!CIRCLE_API_KEY) return res.status(500).json({ error:"Missing CIRCLE_API_KEY" });

  const id = (req.query?.id || "").toString();
  if (!id) return res.status(400).json({ error:"Missing ?id=payoutId" });

  const r = await fetch(`${CIRCLE_BASE}/v1/payouts/${id}`, {
    headers: { Authorization: `Bearer ${CIRCLE_API_KEY}` }
  });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) return res.status(r.status).json({ ok:false, error: j || txt });

  return res.status(200).json({ ok:true, result: j?.data || j });
}

/* ========== 6) Payout status podľa paymentIntentId (pre “ďakujeme” stránku) ========== */
async function payoutStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed" });
  const pi = (req.query?.pi || "").toString();
  if (!pi) return res.status(400).json({ error:"Missing ?pi=paymentIntentId" });

  const rec = PayoutDB.get(pi);
  if (!rec) return res.status(200).json({ ok:true, state:"unknown" });

  // Ak máme payoutId, môžeme voliteľne “freshnúť” stav z Circle (bez pollingu)
  if (rec.payoutId) {
    try {
      const r = await fetch(`${CIRCLE_BASE}/v1/payouts/${rec.payoutId}`, {
        headers: { Authorization: `Bearer ${CIRCLE_API_KEY}` }
      });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      if (r.ok) {
        rec.status = (j?.data?.status || rec.status || "").toLowerCase();
        rec.updatedAt = Date.now();
        PayoutDB.set(pi, rec);
      }
    } catch {}
  }

  return res.status(200).json({
    ok: true,
    state: rec.status || "queued",
    payoutId: rec.payoutId || null,
    amount: rec.amount,
    currency: rec.currency,
    contract: rec.contract,
    updatedAt: rec.updatedAt,
  });
}

/* ========== 7) Logger (nemeníme tvoje logovanie) ========== */
async function chainPosPaidLog(req, res) {
  const body = await readJsonBody(req);
  console.log("[POSPAIDLOG]", new Date().toISOString(), body.stage || "UNSPECIFIED", body.data || {});
  return res.status(200).json({ ok:true, stage: body.stage || "UNSPECIFIED" });
}

/* ========== Helpers ========== */
function uuid(){ if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {const r=(Math.random()*16)|0, v=c==="x"?r:(r&0x3)|0x8; return v.toString(16);});
}
async function readJsonBody(req){ if(req.body && typeof req.body==="object") return req.body;
  const chunks=[]; for await (const ch of req) chunks.push(ch); const raw=Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// fire-and-forget volanie circle_payout so zápisom do PayoutDB
async function triggerCirclePayout({ pi, amount, currency, to }) {
  try {
    if (!BASE_URL) return;
    const r = await fetch(`${BASE_URL}/api/chainvers?action=circle_payout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: String(amount), currency, to, ref: pi })
    });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    if (!r.ok) {
      const prev = PayoutDB.get(pi) || {};
      PayoutDB.set(pi, { ...prev, status: "failed", updatedAt: Date.now() });
      console.error("[triggerCirclePayout] error", t);
      return;
    }
    const data = j?.result || j?.data || j;
    const prev = PayoutDB.get(pi) || {};
    PayoutDB.set(pi, {
      ...prev,
      payoutId: data?.id || prev.payoutId || null,
      status: (data?.status || "created").toLowerCase(),
      amount, currency, contract: to,
      updatedAt: Date.now(),
    });
  } catch (e) {
    const prev = PayoutDB.get(pi) || {};
    PayoutDB.set(pi, { ...prev, status: "failed", updatedAt: Date.now() });
    console.error("[triggerCirclePayout] fatal", e?.message || e);
  }
}