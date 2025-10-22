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
    COINBASE_API_PASSPHRASE: process.env.COINBASE_API_PASSPHRASE || "",
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
    if (action === "coinbase_test_buy")      return coinbaseTestBuy(req, res);
    if (action === "coinbase_test_withdraw") return coinbaseTestWithdraw(req, res);
    if (action === "coinbase_auto_buy")      return coinbaseAutoBuy(req, res);
    if (action === "ping")                   return res.status(200).json({ ok: true, now: new Date().toISOString() });
    if (action === "env")                    return debugEnv(req, res);

    return res.status(404).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function debugEnv(req, res) {
  const E = readEnv();
  const out = {
    STRIPE_SECRET_KEY: E.STRIPE_SECRET_KEY ? mask(E.STRIPE_SECRET_KEY) : null,
    STRIPE_WEBHOOK_SECRET: E.STRIPE_WEBHOOK_SECRET ? mask(E.STRIPE_WEBHOOK_SECRET) : null,
    INF_FREE_URL: E.INF_FREE_URL || null,
    COINBASE_API_KEY: E.COINBASE_API_KEY ? mask(E.COINBASE_API_KEY) : null,
    COINBASE_API_SECRET: E.COINBASE_API_SECRET ? mask(E.COINBASE_API_SECRET) : null,
    COINBASE_API_PASSPHRASE: E.COINBASE_API_PASSPHRASE ? mask(E.COINBASE_API_PASSPHRASE) : null,
    COINBASE_BASE_URL: E.COINBASE_BASE_URL || null,
    CONTRACT_ADDRESS: E.CONTRACT_ADDRESS ? mask(E.CONTRACT_ADDRESS) : null,
  };
  return res.status(200).json(out);
}

// ---------------- STRIPE ----------------

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const E = readEnv();
  if (!E.STRIPE_WEBHOOK_SECRET) return res.status(200).json({ ok: true, note: "webhook_secret_missing (noop)" });

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

  const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!handled.has(event.type)) return;

  const s = event.data.object;
  const pi = s.payment_intent;
  const amount = (s.amount_total ?? s.amount_subtotal ?? 0) / 100;
  const currency = (s.currency ?? "EUR").toUpperCase();
  const meta = s.metadata || {};

  try {
    const payload = {
      paymentIntentId: pi,
      amount,
      currency,
      crop_data: safeParseJSON(meta.crop_data),
      user_address: meta.user_address || null,
      status: "paid",
      source: "stripe_webhook",
      ts: Date.now(),
    };
    const r = await fetch(`${E.INF_FREE_URL}/accptpay.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    console.log("[IF accptpay.php]", r.status, txt.slice(0, 300));
  } catch (e) {
    console.warn("[IF accptpay.php] failed:", e?.message || e);
  }
  Local.payouts.set(pi, { state: "queued", amount, currency, at: Date.now() });
}

// ---------------- COINBASE ----------------

async function coinbaseTestBuy(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const product = String(q.product || "USDC-EUR");
    const amountEur = Number(q.amount || 10);
    const out = await cb_placeMarketBuy(product, amountEur);
    return res.status(200).json(out);
  } catch (e) {
    console.error("[coinbaseTestBuy] error", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function coinbaseTestWithdraw(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const asset = String(q.asset || "USDC");
    const amount = String(q.amount || "5");
    const address = String(q.address || readEnv().CONTRACT_ADDRESS);
    const out = await cb_withdrawToAddress({ asset, amount, address });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[coinbaseTestWithdraw] error", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------- AUTO BUY ----------------

async function coinbaseAutoBuy(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const amountEur = Number(q.amount || 0);
    const product = String(q.product || "ETH-EUR");
    if (!amountEur || amountEur <= 0) return res.status(400).json({ error: "Missing or invalid amount" });

    console.log(`[coinbaseAutoBuy] Spúšťam auto BUY ${amountEur} € → ${product}`);
    const result = await cb_placeMarketBuy(product, amountEur);

    const E = readEnv();
    const tx = await cb_withdrawToAddress({
      asset: product.split("-")[0],
      amount: String(amountEur),
      address: E.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000",
    });

    return res.status(200).json({
      ok: true,
      note: "Auto-buy + withdraw completed",
      buy: result,
      withdraw: tx,
    });
  } catch (e) {
    console.error("[coinbaseAutoBuy] error", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ======================================================================
   COINBASE HELPERS
   ====================================================================== */
async function cb_placeMarketBuy(product_id, amountEur) {
  requireCBEnv();
  const path = "/api/v3/brokerage/orders";
  const body = {
    client_order_id: uuid(),
    product_id,
    side: "BUY",
    order_configuration: { market_market_ioc: { quote_size: String(amountEur) } },
  };
  const r = await cbSignedFetch("POST", path, body);
  if (!r.ok) throw new Error(`CB BUY failed: ${r.status} ${r.text}`);
  return r.json;
}

async function cb_withdrawToAddress({ asset, amount, address }) {
  requireCBEnv();
  const path = "/withdrawals/crypto";
  const body = { currency: asset, amount: String(amount), crypto_address: address };
  const r = await cbSignedFetch("POST", path, body);
  if (!r.ok) throw new Error(`CB WITHDRAW failed: ${r.status} ${r.text}`);
  return r.json;
}

async function cbSignedFetch(method, path, bodyObj) {
  const { COINBASE_API_SECRET, COINBASE_API_KEY, COINBASE_BASE_URL, COINBASE_API_PASSPHRASE } = readEnv();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const prehash = timestamp + method.toUpperCase() + path + body;
  const hmac = crypto.createHmac("sha256", COINBASE_API_SECRET).update(prehash).digest("base64");

  const url = (COINBASE_BASE_URL || "https://api.coinbase.com") + path;
  const headers = {
    "CB-ACCESS-KEY": COINBASE_API_KEY,
    "CB-ACCESS-SIGN": hmac,
    "CB-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };
  if (COINBASE_API_PASSPHRASE) headers["CB-ACCESS-PASSPHRASE"] = COINBASE_API_PASSPHRASE;

  const resp = await fetch(url, { method, headers, body: body || undefined });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: resp.ok, status: resp.status, text, json };
}

function requireCBEnv() {
  const { COINBASE_API_KEY, COINBASE_API_SECRET } = readEnv();
  if (!COINBASE_API_KEY || !COINBASE_API_SECRET)
    throw new Error("Missing Coinbase API credentials in ENV");
}

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

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}