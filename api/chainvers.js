// pages/api/chainvers.js
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const { action } = req.query || {};
  if (!action)
    return res.status(400).json({
      error: "Missing ?action=",
      available: ["stripe_webhook", "circle_payout", "chainpospaidlog"],
    });

  try {
    if (action === "stripe_webhook") return stripeWebhook(req, res);
    if (action === "circle_payout") return circlePayout(req, res);
    if (action === "chainpospaidlog") return chainPosPaidLog(req, res);
    return res.status(404).json({ error: "Unknown action" });
  } catch (e) {
    console.error("[CHAINVERS]", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}

//
// === STRIPE WEBHOOK ===
//
async function stripeWebhook(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const rawBody = Buffer.concat(chunks);
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!handled.has(event.type)) return res.status(200).json({ received: true });

  const s = event.data.object;
  const amount = (s.amount_total ?? 0) / 100;
  const currency = (s.currency ?? "eur").toUpperCase();
  const baseURL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  await logStage(baseURL, "STRIPE.PAYMENT.SUCCESS", { id: s.id, amount, currency });

  // Circle payout
  await fetch(`${baseURL}/api/chainvers?action=circle_payout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, currency: "USDC", to: process.env.CONTRACT_ADDRESS }),
  });

  await logStage(baseURL, "PROCESS.COMPLETE", { id: s.id });
  return res.status(200).json({ ok: true });
}

//
// === CIRCLE PAYOUT ===
//
async function circlePayout(req, res) {
  const apiKey = process.env.CIRCLE_API_KEY;
  const base = process.env.CIRCLE_BASE || "https://api.circle.com";
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

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address: contract },
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

  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!r.ok) return res.status(r.status).json({ ok: false, error: json || txt });

  await logStage(process.env.BASE_URL, "CIRCLE.PAYOUT.RESULT", json?.data);
  return res.status(200).json({ ok: true, result: json?.data });
}

//
// === LOGGER ===
//
async function chainPosPaidLog(req, res) {
  let body = req.body;
  if (!body || typeof body !== "object") {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8");
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }

  const { stage = "UNSPECIFIED", data = {} } = body;
  console.log("[LOG]", new Date().toISOString(), stage, data);
  return res.status(200).json({ ok: true, stage });
}

//
// === HELPERS ===
//
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function logStage(baseURL, stage, data) {
  try {
    await fetch(`${baseURL}/api/chainvers?action=chainpospaidlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, data }),
    });
  } catch (e) {
    console.error("[LOG ERR]", e.message);
  }
}