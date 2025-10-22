// pages/api/chainvers.js
import Stripe from "stripe";
import crypto from "crypto";

export const config = { api: { bodyParser: false } };

function readEnv() {
  const env = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    INF_FREE_URL: process.env.INF_FREE_URL || "https://chainvers.free.nf",

    COINBASE_API_KEY: process.env.COINBASE_API_KEY || "",
    COINBASE_API_SECRET: process.env.COINBASE_API_SECRET || "",
    COINBASE_BASE_URL: process.env.COINBASE_BASE_URL || "https://api.coinbase.com",

    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "",
  };
  return env;
}

function mask(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return s[0] + "****";
  return s.slice(0, 6) + "..." + s.slice(-4);
}

const Local = { payouts: new Map() };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "").toLowerCase();
  console.log("[CHAINVERS] Incoming", { method: req.method, action });

  try {
    if (action === "create_payment_proxy")   return createPaymentProxy(req, res);
    if (action === "stripe_session_status")  return stripeSessionStatus(req, res);
    if (action === "stripe_webhook")         return stripeWebhook(req, res);
    if (action === "coinbase_auto_buy")      return coinbaseAutoBuy(req, res);
    if (action === "coinbase_advanced_buy")  return coinbaseAdvancedBuy(req, res);
    if (action === "ping")                   return res.status(200).json({ ok: true, now: new Date().toISOString() });
    if (action === "env")                    return debugEnv(req, res);
    return res.status(404).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ======================================================
// Debug ENV
// ======================================================
async function debugEnv(req, res) {
  const E = readEnv();
  const out = {
    STRIPE_SECRET_KEY: mask(E.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: mask(E.STRIPE_WEBHOOK_SECRET),
    INF_FREE_URL: E.INF_FREE_URL,
    COINBASE_API_KEY: mask(E.COINBASE_API_KEY),
    COINBASE_API_SECRET: E.COINBASE_API_SECRET ? "🔒 [PRIVATE KEY PRESENT]" : null,
    COINBASE_BASE_URL: E.COINBASE_BASE_URL,
    CONTRACT_ADDRESS: mask(E.CONTRACT_ADDRESS),
  };
  return res.status(200).json(out);
}

// ======================================================
// STRIPE HANDLERS
// ======================================================

async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const E = readEnv();
  if (!E.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body || {};
    if (!amount || !currency) return res.status(400).json({ error: "Missing amount or currency" });

    const stripe = new Stripe(E.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: String(currency).toLowerCase(),
          product_data: { name: description || "CHAINVERS objednávka" },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      }],
      metadata: {
        crop_data: JSON.stringify(crop_data || {}),
        user_address: user_address || "unknown",
      },
      success_url: `${E.INF_FREE_URL}/thankyou.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${E.INF_FREE_URL}/index.php`,
    });

    console.log("[createPaymentProxy] session created", session.id);
    return res.status(200).json({ checkout_url: session.url });
  } catch (err) {
    console.error("[createPaymentProxy] error", err?.message || err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

async function stripeSessionStatus(req, res) {
  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  try {
    const E = readEnv();
    const stripe = new Stripe(E.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    return res.status(200).json({
      id: session.id,
      payment_status: session.payment_status,
      payment_intent: session.payment_intent?.id,
      metadata: session.metadata || {},
    });
  } catch (e) {
    console.error("[stripeSessionStatus] error", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function stripeWebhook(req, res) {
  const E = readEnv();
  const stripe = new Stripe(E.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const rawBody = await readRaw(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], E.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripeWebhook] bad signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.status(200).json({ received: true });

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const meta = s.metadata || {};
    const payload = {
      paymentIntentId: s.payment_intent,
      amount: (s.amount_total ?? 0) / 100,
      currency: s.currency?.toUpperCase() ?? "EUR",
      crop_data: safeParseJSON(meta.crop_data),
      user_address: meta.user_address || "unknown",
      status: "paid",
      ts: Date.now(),
    };

    try {
      await fetch(`${E.INF_FREE_URL}/accptpay.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[Webhook → accptpay] failed:", err.message);
    }
  }
}

// ======================================================
// COINBASE ADVANCED TRADE API  (no org_id, no passphrase)
// ======================================================

async function coinbaseAdvancedBuy(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const amountEur = Number(q.amount || 10);
    const productId = String(q.product || "ETH-EUR");

    console.log(`[coinbaseAdvancedBuy] BUY ${amountEur} EUR of ${productId}`);

    const result = await cb_advancedPlaceMarketBuy(productId, amountEur);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[coinbaseAdvancedBuy] error", err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function cb_advancedPlaceMarketBuy(product_id, amountEur) {
  const E = readEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v3/brokerage/orders";
  const body = {
    client_order_id: crypto.randomUUID(),
    product_id,
    side: "BUY",
    order_configuration: { market_market_ioc: { quote_size: String(amountEur) } },
  };
  const bodyStr = JSON.stringify(body);
  const prehash = timestamp + "POST" + path + bodyStr;
  const signature = crypto.createHmac("sha256", E.COINBASE_API_SECRET).update(prehash).digest("base64");

  const headers = {
    "CB-ACCESS-KEY": E.COINBASE_API_KEY,
    "CB-ACCESS-SIGN": signature,
    "CB-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };

  const url = `${E.COINBASE_BASE_URL}${path}`;
  const r = await fetch(url, { method: "POST", headers, body: bodyStr });
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json, raw: text };
}

// ======================================================
// UTILITIES
// ======================================================
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRaw(req);
  try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
}

async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks);
}

function safeParseJSON(x) {
  if (!x || typeof x !== "string") return null;
  try { return JSON.parse(x); } catch { return null; }
}