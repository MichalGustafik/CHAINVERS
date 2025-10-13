// pages/api/chainvers.js
import Stripe from "stripe";

// nechaj takto (RAW body pre webhook)
export const config = { api: { bodyParser: false } };

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const BASE_URL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  // 🟡 VSTUPNÝ LOG – uvidíš v Vercel → Functions → Logs
  console.log("[CHAINVERS] ->", {
    method: req.method,
    action,
    url: req.url,
    ua: req.headers["user-agent"],
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
  });

  try {
    // 🆕 Základné health-checky
    if (action === "ping") return res.status(200).json({ ok: true, now: new Date().toISOString() });

    if (action === "echo") {
      const body = await readJsonBody(req);
      return res.status(200).json({ ok: true, method: req.method, query: req.query, body });
    }

    if (action === "stripe_checkout")     return await stripeCheckout(req, res);
    if (action === "create_payment_proxy")return await createPaymentProxy(req, res);
    if (action === "stripe_webhook")      return await stripeWebhook(req, res);
    if (action === "circle_payout")       return await circlePayout(req, res);
    if (action === "chainpospaidlog")     return await chainPosPaidLog(req, res);

    return res.status(400).json({ error: "Missing or unknown ?action=", available: ["ping","echo","stripe_checkout","create_payment_proxy","stripe_webhook","circle_payout","chainpospaidlog"] });
  } catch (e) {
    console.error("[CHAINVERS] Unhandled error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ------------------------- 1) STRIPE CHECKOUT -------------------------*/
async function stripeCheckout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = await readJsonBody(req);
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  console.log("[stripeCheckout] start", { amount: body.amount, currency: body.currency });

  const stripe = new Stripe(STRIPE_SECRET);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "amount must be integer (cents)" });

  const currency   = (body.currency || "eur").toLowerCase();
  const successUrl = body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = body.cancel_url  || `${BASE_URL}/cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: { currency, product_data: { name: "CHAINVERS Order" }, unit_amount: amount },
        quantity: 1
      }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: body.metadata || {}
    });

    console.log("[stripeCheckout] ok", { sessionId: session.id });
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    console.error("[stripeCheckout] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ------------------------- 2) STRIPE PROXY (pre InfinityFree) -------------------------*/
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = await readJsonBody(req);
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  console.log("[createPaymentProxy] start", { amount: body.amount, currency: body.currency });

  const amount = String(body.amount);
  const currency   = (body.currency || "eur").toLowerCase();
  const successUrl = body.success_url || `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = body.cancel_url  || `${BASE_URL}/cancel`;
  const metadata = body.metadata || {};

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", successUrl);
  params.append("cancel_url", cancelUrl);
  params.append("line_items[0][price_data][currency]", currency);
  params.append("line_items[0][price_data][product_data][name]", "CHAINVERS Order");
  params.append("line_items[0][price_data][unit_amount]", amount);
  params.append("line_items[0][quantity]", "1");
  for (const [k, v] of Object.entries(metadata)) {
    params.append(`metadata[${k}]`, typeof v === "string" ? v : JSON.stringify(v));
  }

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${STRIPE_SECRET}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) {
      console.error("[createPaymentProxy] Stripe error", txt);
      return res.status(r.status).json({ error: j || txt });
    }
    console.log("[createPaymentProxy] ok", { sessionId: j.id });
    return res.status(200).json({ id: j.id, url: j.url });
  } catch (e) {
    console.error("[createPaymentProxy] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ------------------------- 3) STRIPE WEBHOOK -------------------------*/
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!STRIPE_SECRET) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = new Stripe(STRIPE_SECRET);

  // RAW body
  const chunks = []; for await (const ch of req) chunks.push(ch);
  const rawBody = Buffer.concat(chunks);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], endpointSecret);
  } catch (err) {
    console.error("[stripeWebhook] ❌ Signature failed", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("[stripeWebhook] incoming", { type: event.type, id: event.id });

  const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!handled.has(event.type)) {
    console.log("[stripeWebhook] ignored", event.type);
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const paymentIntentId = session.payment_intent;
  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency ?? "eur").toUpperCase();
  const metadata = session.metadata || {};

  console.log("[stripeWebhook] ✅ Payment", { paymentIntentId, amount, currency });

  await postLog("STRIPE.PAYMENT.SUCCESS", { paymentIntentId, amount, currency, metadata });

  // posielame celú sumu – uprav ak chceš len časť
  const circlePayload = { amount: String(Number(amount).toFixed(2)), currency: "USDC", to: process.env.CONTRACT_ADDRESS };

  try {
    const payoutResp = await fetch(`${BASE_URL}/api/chainvers?action=circle_payout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(circlePayload)
    });
    const payoutTxt = await payoutResp.text();
    let payoutJson = null; try { payoutJson = JSON.parse(payoutTxt); } catch {}
    await postLog("CIRCLE.PAYOUT.RESULT", { ok: payoutResp.ok, status: payoutResp.status, body: payoutJson || payoutTxt });
  } catch (e) {
    console.error("[stripeWebhook] circle_payout call failed", e);
    await postLog("CIRCLE.PAYOUT.ERROR", { error: e?.message || String(e) });
  }

  await postLog("PROCESS.COMPLETE", { paymentIntentId });
  return res.status(200).json({ received: true });
}

/* ------------------------- 4) CIRCLE PAYOUT -------------------------*/
async function circlePayout(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!CIRCLE_API_KEY) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });

  const body = await readJsonBody(req);
  const amount = body.amount;
  const currency = body.currency || "USDC";
  const address = body.to || CONTRACT_ADDRESS;
  if (!address) return res.status(400).json({ error: "Missing CONTRACT_ADDRESS or body.to" });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Missing/invalid amount" });

  console.log("[circlePayout] start", { amount, currency, address, chain: PAYOUT_CHAIN });

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address },
    amount: { amount: String(amount), currency },
    chain: PAYOUT_CHAIN,
  };

  try {
    const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CIRCLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}

    if (!r.ok) {
      console.error("[circlePayout] ❌ Circle error", txt);
      await postLog("CIRCLE.PAYOUT.ERROR", { status: r.status, body: j || txt });
      return res.status(r.status).json({ ok: false, error: j || txt });
    }

    console.log("[circlePayout] ok", j?.data || j);
    await postLog("CIRCLE.PAYOUT.SUCCESS", { payout: j?.data || j });
    return res.status(200).json({ ok: true, result: j?.data || j });

  } catch (e) {
    console.error("[circlePayout] FATAL", e);
    await postLog("CIRCLE.PAYOUT.FATAL", { error: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

/* ------------------------- 5) LOGGER -------------------------*/
async function chainPosPaidLog(req, res) {
  const body = await readJsonBody(req);
  const stage = body.stage || "UNSPECIFIED";
  const data = body.data || {};
  console.log("[POSPAIDLOG]", new Date().toISOString(), stage, data);
  return res.status(200).json({ ok: true, stage });
}

/* ------------------------- Helpers -------------------------*/
function uuid(){ if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {const r=(Math.random()*16)|0, v=c==="x"?r:(r&0x3)|0x8; return v.toString(16);});
}
async function readJsonBody(req){ if(req.body && typeof req.body==="object") return req.body;
  const chunks=[]; for await (const ch of req) chunks.push(ch); const raw=Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
async function postLog(stage, data){
  try{
    if (!BASE_URL) { console.log("[postLog/skip]", stage, data); return; }
    await fetch(`${BASE_URL}/api/chainvers?action=chainpospaidlog`, {
      method: "POST", headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ stage, data })
    });
  }catch(e){ console.error("[postLog] failed", e?.message || e); }
}