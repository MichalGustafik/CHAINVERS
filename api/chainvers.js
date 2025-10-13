// pages/api/chainvers.js
// Multifunkčný endpoint: ?action=stripe_checkout | create_payment_proxy | stripe_webhook | circle_payout | chainpospaidlog
import Stripe from "stripe";

export const config = { api: { bodyParser: false } }; // potrebujeme RAW body pre Stripe webhook

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const BASE_URL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  try {
    if (action === "stripe_checkout") return await stripeCheckout(req, res);
    if (action === "create_payment_proxy") return await createPaymentProxy(req, res);
    if (action === "stripe_webhook") return await stripeWebhook(req, res);
    if (action === "circle_payout") return await circlePayout(req, res);
    if (action === "chainpospaidlog") return await chainPosPaidLog(req, res);

    return res.status(400).json({ error: "Missing or unknown ?action= (available: stripe_checkout, create_payment_proxy, stripe_webhook, circle_payout, chainpospaidlog)" });
  } catch (e) {
    console.error("[CHAINVERS] Unhandled error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* -------------------------
   1) STRIPE CHECKOUT (creates Checkout Session via Stripe SDK)
   Endpoint: POST /api/chainvers?action=stripe_checkout
   Body JSON: {
     amount: 10299,         // in cents (integer)
     currency: "eur",
     success_url, cancel_url,
     metadata: { crop_data, user_address }
   }
-------------------------*/
async function stripeCheckout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = await readJsonBody(req);
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  const stripe = new Stripe(STRIPE_SECRET);

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "amount must be integer (cents)" });

  const currency = (body.currency || "eur").toString().toLowerCase();
  const success_url = body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = body.cancel_url || `${BASE_URL}/cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency,
          product_data: { name: "CHAINVERS Order" },
          unit_amount: amount,
        },
        quantity: 1
      }],
      success_url,
      cancel_url,
      metadata: body.metadata || {}
    });

    // return minimal fields for PHP redirect
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    console.error("[stripeCheckout] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* -------------------------
   2) CREATE PAYMENT PROXY (for hosts that block outbound requests)
   Endpoint: POST /api/chainvers?action=create_payment_proxy
   Body JSON: same shape as stripeCheckout but proxy will call Stripe API server-side (urlencoded)
   Use when InfinityFree cannot reach Stripe directly.
-------------------------*/
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = await readJsonBody(req);
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  const amount = String(body.amount);
  const currency = (body.currency || "eur").toString().toLowerCase();
  const success_url = body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = body.cancel_url || `${BASE_URL}/cancel`;
  const metadata = body.metadata || {};

  // prepare x-www-form-urlencoded body
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", success_url);
  params.append("cancel_url", cancel_url);
  params.append("line_items[0][price_data][currency]", currency);
  params.append("line_items[0][price_data][product_data][name]", "CHAINVERS Order");
  params.append("line_items[0][price_data][unit_amount]", amount);
  params.append("line_items[0][quantity]", "1");
  // metadata entries
  for (const [k, v] of Object.entries(metadata)) {
    params.append(`metadata[${k}]`, typeof v === "string" ? v : JSON.stringify(v));
  }

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    if (!r.ok) {
      console.error("[createPaymentProxy] Stripe error", txt);
      return res.status(r.status).json({ error: j || txt });
    }
    // Stripe returns `url` in the response
    return res.status(200).json({ id: j.id, url: j.url });
  } catch (e) {
    console.error("[createPaymentProxy] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* -------------------------
   3) STRIPE WEBHOOK (raw body required)
   Endpoint: POST /api/chainvers?action=stripe_webhook
-------------------------*/
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = new Stripe(STRIPE_SECRET);

  // read raw body
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const rawBody = Buffer.concat(chunks);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], endpointSecret);
  } catch (err) {
    console.error("[stripeWebhook] Signature failed", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!handled.has(event.type)) {
    console.log("[stripeWebhook] Ignored event", event.type);
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const paymentIntentId = session.payment_intent;
  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency ?? "eur").toUpperCase();
  const metadata = session.metadata || {};

  console.log("[WEBHOOK] Payment success", { paymentIntentId, amount, currency });

  // Log start
  await postLog("STRIPE.PAYMENT.SUCCESS", { paymentIntentId, amount, currency, metadata });

  // Prepare payout amount (here we send full amount or adjust as needed)
  const payoutAmount = Number((Math.round(amount * 100) / 100).toFixed(2)); // float in EUR
  // If you want to convert currency logic, adapt here. We call circle_payout with USDC amount representation
  const circlePayload = { amount: String(payoutAmount), currency: "USDC", to: process.env.CONTRACT_ADDRESS };

  // Call circle payout
  try {
    const payoutResp = await fetch(`${BASE_URL}/api/chainvers?action=circle_payout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(circlePayload)
    });
    const payoutTxt = await payoutResp.text();
    let payoutJson = null;
    try { payoutJson = JSON.parse(payoutTxt); } catch {}
    await postLog("CIRCLE.PAYOUT.RESULT", { ok: payoutResp.ok, status: payoutResp.status, body: payoutJson || payoutTxt });
  } catch (e) {
    console.error("[stripeWebhook] circle_payout call failed", e);
    await postLog("CIRCLE.PAYOUT.ERROR", { error: e?.message || String(e) });
  }

  await postLog("PROCESS.COMPLETE", { paymentIntentId });
  return res.status(200).json({ received: true });
}

/* -------------------------
   4) CIRCLE PAYOUT (uses only CIRCLE_API_KEY, CIRCLE_BASE, PAYOUT_CHAIN, CONTRACT_ADDRESS)
   Endpoint: POST /api/chainvers?action=circle_payout
   Body JSON: { amount: "10.00", currency: "USDC", to: "0x..." }
-------------------------*/
async function circlePayout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!CIRCLE_API_KEY) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
  if (!CONTRACT_ADDRESS && !((await readJsonBody(req)).to)) return res.status(400).json({ error: "Missing CONTRACT_ADDRESS or body.to" });

  const body = await readJsonBody(req);
  const amount = body.amount;
  const currency = body.currency || "USDC";
  const address = body.to || CONTRACT_ADDRESS;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Missing/invalid amount" });

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address },
    amount: { amount: String(amount), currency },
    chain: PAYOUT_CHAIN,
  };

  try {
    const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CIRCLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) {
      console.error("[circlePayout] Circle returned error", txt);
      await postLog("CIRCLE.PAYOUT.ERROR", { status: r.status, body: j || txt });
      return res.status(r.status).json({ ok: false, error: j || txt });
    }
    await postLog("CIRCLE.PAYOUT.SUCCESS", { payout: j?.data || j });
    return res.status(200).json({ ok: true, result: j?.data || j });
  } catch (e) {
    console.error("[circlePayout] ERROR", e);
    await postLog("CIRCLE.PAYOUT.FATAL", { error: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

/* -------------------------
   5) SIMPLE LOGGER (chainpospaidlog)
   Endpoint: POST /api/chainvers?action=chainpospaidlog
-------------------------*/
async function chainPosPaidLog(req, res) {
  const body = await readJsonBody(req);
  const stage = body.stage || "UNSPECIFIED";
  const data = body.data || {};
  console.log("[POSPAIDLOG]", new Date().toISOString(), stage, data);
  // optionally forward to external sinks if you set LOG_HTTP_URL / LOG_USER_DIR_URL in .env
  if (process.env.LOG_HTTP_URL) {
    try {
      await fetch(process.env.LOG_HTTP_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: process.env.LOG_HTTP_AUTH || "" }, body: JSON.stringify({ stage, data, ts: new Date().toISOString() }) });
    } catch (e) { console.error("[POSPAIDLOG] forward failed", e?.message || e); }
  }
  return res.status(200).json({ ok: true, stage });
}

/* -------------------------
   Helpers
-------------------------*/
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function postLog(stage, data) {
  try {
    if (!BASE_URL) { console.log("[postLog] no BASE_URL, skipping", stage, data); return; }
    await fetch(`${BASE_URL}/api/chainvers?action=chainpospaidlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, data })
    });
  } catch (e) {
    console.error("[postLog] failed", e?.message || e);
  }
}