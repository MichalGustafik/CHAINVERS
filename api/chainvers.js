// pages/api/chainvers.js
import Stripe from "stripe";
import crypto from "crypto";

// Vercel: zachováme raw body pre Stripe webhook
export const config = { api: { bodyParser: false } };

/**
 * ENV – nastav na Verceli:
 * STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 * INF_FREE_URL (napr. https://chainvers.free.nf)
 * (voliteľné) COINBASE_API_KEY, COINBASE_API_SECRET, COINBASE_API_PASSPHRASE, COINBASE_BASE_URL
 * (voliteľné) CONTRACT_ADDRESS
 */
const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET || "";
const INF_FREE_URL = process.env.INF_FREE_URL || "https://chainvers.free.nf";

const CB_KEY       = process.env.COINBASE_API_KEY || "";
const CB_SECRET    = process.env.COINBASE_API_SECRET || "";
const CB_PASSPH    = process.env.COINBASE_API_PASSPHRASE || "";
const CB_BASE_URL  = process.env.COINBASE_BASE_URL || "https://api.coinbase.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";

const Local = { payouts: new Map() };

// ------------------------------
// Router
// ------------------------------
export default async function handler(req, res) {
  const action = String(req.query?.action || "").toLowerCase();

  try {
    if (action === "create_payment_proxy")  return createPaymentProxy(req, res);
    if (action === "stripe_session_status") return stripeSessionStatus(req, res);
    if (action === "stripe_webhook")        return stripeWebhook(req, res);
    if (action === "coinbase_test_buy")     return coinbaseTestBuy(req, res);
    if (action === "coinbase_test_withdraw")return coinbaseTestWithdraw(req, res);
    if (action === "ping")                  return res.status(200).json({ ok: true, now: new Date().toISOString() });

    return res.status(404).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ------------------------------
// 1) Stripe – Create Checkout Session (proxy pre InfinityFree PHP)
// ------------------------------
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!STRIPE_KEY || !STRIPE_KEY.startsWith("sk_")) {
    return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
  }

  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body || {};
    if (!amount || !currency) return res.status(400).json({ error: "Missing amount or currency" });

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

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
      success_url: `${INF_FREE_URL}/thankyou.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${INF_FREE_URL}/index.php`,
    });

    return res.status(200).json({ checkout_url: session.url });
  } catch (err) {
    console.error("[createPaymentProxy] error", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ------------------------------
// 2) Stripe – Session Status (pre IF thankyou.php)
// ------------------------------
async function stripeSessionStatus(req, res) {
  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  try {
    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });

    return res.status(200).json({
      id: session.id,
      payment_status: session.payment_status,
      payment_intent: session.payment_intent?.id,
      metadata: session.metadata || {},
    });
  } catch (e) {
    console.error("[stripeSessionStatus] error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ------------------------------
// 3) Stripe – Webhook: po úspechu zapíš na IF (accptpay.php)
// ------------------------------
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!STRIPE_WHSEC) return res.status(200).json({ ok: true, note: "webhook_secret_missing (noop)" });

  const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });
  const rawBody = await readRaw(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WHSEC);
  } catch (err) {
    console.error("[stripeWebhook] bad signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!handled.has(event.type)) return res.status(200).json({ received: true });

  const s = event.data.object;
  const pi = s.payment_intent;
  const amount = (s.amount_total ?? 0) / 100;
  const currency = (s.currency ?? "EUR").toUpperCase();
  const meta = s.metadata || {};

  // 3.1) zapíš na InfinityFree (accptpay.php – všetko v jednom)
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

    const r = await fetch(`${INF_FREE_URL}/accptpay.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    console.log("[IF accptpay.php]", r.status, txt.slice(0, 300));
  } catch (e) {
    console.warn("[IF accptpay.php] failed:", e?.message || e);
  }

  // 3.2) (voliteľne) lokálny stav
  Local.payouts.set(pi, { state: "queued", amount, currency, at: Date.now() });

  return res.status(200).json({ received: true });
}

// ------------------------------
// 4) Coinbase – manuálne testy (neovplyvňujú Stripe create)
// ------------------------------
async function coinbaseTestBuy(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const product = String(q.product || "USDC-EUR");
    const amountEur = Number(q.amount || 10);
    const out = await cb_placeMarketBuy(product, amountEur);
    return res.status(200).json(out);
  } catch (e) {
    console.error("[coinbaseTestBuy] error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function coinbaseTestWithdraw(req, res) {
  try {
    const q = req.method === "POST" ? await readJson(req) : req.query;
    const asset = String(q.asset || "USDC");
    const amount = String(q.amount || "5");
    const address = String(q.address || CONTRACT_ADDRESS);
    const out = await cb_withdrawToAddress({ asset, amount, address });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[coinbaseTestWithdraw] error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

/* ======================================================================
   COINBASE HELPERS (Advanced Trade / Exchange) — voliteľné
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
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const prehash = timestamp + method.toUpperCase() + path + body;
  const hmac = crypto.createHmac("sha256", CB_SECRET).update(prehash).digest("base64");

  const url = CB_BASE_URL + path;
  const headers = {
    "CB-ACCESS-KEY": CB_KEY,
    "CB-ACCESS-PASSPHRASE": CB_PASSPH,
    "CB-ACCESS-SIGN": hmac,
    "CB-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };

  const resp = await fetch(url, { method, headers, body: body || undefined });
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: resp.ok, status: resp.status, text, json };
}

function requireCBEnv() {
  if (!CB_KEY || !CB_SECRET || !CB_PASSPH) {
    throw new Error("Missing Coinbase API credentials in ENV");
  }
}

// heuristika: po nákupe odhadneme send amount (USDC ~ 1:1 EUR; ETH hrubý odhad)
async function inferSendAmount(asset, eurValue) {
  if (asset === "USDC") return String(Math.max(0.01, Math.round(eurValue * 100) / 100));
  return String((eurValue / 2000).toFixed(6));
}

/* ======================================================================
   UTIL
   ====================================================================== */
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