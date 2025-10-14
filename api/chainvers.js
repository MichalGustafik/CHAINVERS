// chainvers.js (Vercel API pre InfinityFree a Stripe + Coinbase)

// ==========================================
// IMPORTY A ENV NASTAVENIA
// ==========================================
import Stripe from "stripe";
import crypto from "crypto";

// Node 18+: fetch je vstavaný
if (typeof fetch === "undefined") {
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenne
// ==========================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET;

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const INF_FREE_URL = "https://chainvers.free.nf";

const CHAINVERS_ORDERS_TOKEN = process.env.CHAINVERS_ORDERS_TOKEN;
const SPLITCHAIN_SHARED_TOKEN = process.env.SPLITCHAIN_SHARED_TOKEN;

const CC_API_KEY = process.env.COINBASE_COMMERCE_API_KEY || "";
const CC_API_BASE = "https://api.commerce.coinbase.com";

// ==========================
// Pamäť
// ==========================
const ChargesCache = new Map();
const PayoutDB = new Map();

// ==========================================
// HLAVNÝ ROUTER
// ==========================================
export default async function handler(req, res) {
  const action = (req.query?.action || "").toLowerCase();

  try {
    if (action === "ping") {
      console.log("[CHAINVERS] ping");
      return res.status(200).json({ ok: true, now: new Date().toISOString() });
    }

    if (action === "chainvers_orders") return chainversOrders(req, res);
    if (action === "splitchain") return splitchain(req, res);

    if (action === "create_payment_proxy") return createPaymentProxy(req, res);
    if (action === "stripe_webhook") return stripeWebhook(req, res);
    if (action === "payout_status") return payoutStatus(req, res);

    return res.status(400).json({ ok: false, error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

// ==========================================
// 1️⃣ CREATE PAYMENT PROXY
// ==========================================
async function createPaymentProxy(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body;

    if (!amount || !currency)
      return res.status(400).json({ error: "Missing amount or currency" });

    const stripe = new Stripe(STRIPE_SECRET);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: String(currency).toLowerCase(),
            product_data: { name: description || "CHAINVERS objednávka" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
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

// ==========================================
// 2️⃣ STRIPE WEBHOOK
// ==========================================
async function stripeWebhook(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(STRIPE_SECRET);
  const rawBody = await readRaw(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers["stripe-signature"],
      STRIPE_WHSEC
    );
  } catch (err) {
    console.error("[stripeWebhook] bad signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const okTypes = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ]);
  if (!okTypes.has(event.type)) return res.status(200).json({ received: true });

  const s = event.data.object; // checkout.session
  const pi = s.payment_intent;
  const amount = (s.amount_total ?? 0) / 100;
  const currency = (s.currency ?? "eur").toUpperCase();
  const metadata = s.metadata || {};

  try {
    const confirmPayload = {
      paymentIntentId: pi,
      amount,
      currency,
      crop_data: safeParseJSON(metadata.crop_data),
      user_address: metadata.user_address || null,
      status: "paid",
      source: "stripe_webhook",
      ts: Date.now(),
    };
    const r = await fetch(`${INF_FREE_URL}/confirm_payment.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmPayload),
    });
    const txt = await r.text();
    console.log("[IF confirm_payment.php] status:", r.status, "body:", txt.slice(0, 300));
  } catch (e) {
    console.error("[IF confirm_payment.php] failed", e?.message || e);
  }

  PayoutDB.set(pi, {
    payoutId: null,
    status: "queued",
    amount,
    currency,
    updatedAt: Date.now(),
  });

  console.log("[stripeWebhook] ✅ payment queued", pi);
  return res.status(200).json({ received: true });
}

// ==========================================
// 3️⃣ PAYOUT STATUS
// ==========================================
async function payoutStatus(req, res) {
  const pi = req.query.pi;
  if (!pi) return res.status(400).json({ error: "Missing ?pi" });

  const local = PayoutDB.get(pi);
  if (!local) return res.status(200).json({ ok: true, state: "unknown" });

  return res.status(200).json({
    ok: true,
    state: local.status,
    payoutId: local.payoutId || null,
    amount: local.amount,
    currency: local.currency,
  });
}

// ==========================================
// 4️⃣ CHAINVERS ORDERS (opravené pre InfinityFree)
// ==========================================
async function chainversOrders(req, res) {
  console.log("[CHAINVERS] chainvers_orders called");

  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CHAINVERS_ORDERS_TOKEN || auth !== CHAINVERS_ORDERS_TOKEN) {
    console.warn("[CHAINVERS] bad token");
    return res.status(401).json({ ok: false, error: "bad_token" });
  }

  const body = await readJson(req);
  if (!body || body.kind !== "LIST_PENDING") {
    console.warn("[CHAINVERS] bad payload", body);
    return res.status(400).json({ ok: false, error: "bad_kind" });
  }

  let orders = [];
  try {
    const stripe = new Stripe(STRIPE_SECRET);
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;

    const sessions = await stripe.checkout.sessions.list({
      limit: 20,
      expand: ["data.payment_intent"],
      created: { gte: since },
    });

    for (const s of sessions.data) {
      if (s.payment_status === "paid") {
        orders.push({
          order_id: s.id,
          user_id: s.metadata?.user_id || (s.customer_details?.email ?? "unknown"),
          amount: (s.amount_total ?? 0) / 100,
          currency: (s.currency ?? "eur").toUpperCase(),
          description: s.metadata?.description ?? "CHAINVERS objednávka",
          coinbase_url: null,
        });
      }
    }
  } catch (e) {
    console.error("[CHAINVERS] Stripe fetch failed:", e?.message || e);
  }

  if (!orders.length) {
    console.warn("[CHAINVERS] no Stripe data, using demo fallback");
    orders = [
      { order_id: "demo-1001", user_id: "user-42", amount: 29.9, currency: "EUR", description: "Poster A", coinbase_url: null },
      { order_id: "demo-1002", user_id: "user-99", amount: 12.5, currency: "EUR", description: "Sticker Pack", coinbase_url: null },
    ];
  }

  const enriched = [];
  for (const o of orders) {
    const link = await createCoinbaseCharge(o).catch(() => null);
    enriched.push({ ...o, coinbase_url: link });
  }

  console.log("[CHAINVERS] ✅ Returning", enriched.length, "orders");
  return res.status(200).json({ ok: true, orders: enriched });
}

// ==========================================
// 5️⃣ SPLITCHAIN (po potvrdení objednávky v accptpay.php)
// ==========================================
async function splitchain(req, res) {
  console.log("[CHAINVERS] splitchain called");

  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const body = await readJson(req);
  if (!body || body.token !== SPLITCHAIN_SHARED_TOKEN) {
    console.warn("[CHAINVERS] Bad token in splitchain");
    return res.status(401).json({ ok: false, error: "bad_token" });
  }

  const { order_id, amount, currency } = body;
  console.log("[CHAINVERS] ✅ ACCEPTED ORDER:", order_id, amount, currency);

  // (Budúce rozšírenie: Coinbase API → kúpa ETH a posielanie do kontraktu)
  // Tu zatiaľ simulujeme úspech.
  return res.status(200).json({
    ok: true,
    note: "splitchain simulated OK",
    received: body,
  });
}

// ==========================================
// 6️⃣ COINBASE COMMERCE CHARGE
// ==========================================
async function createCoinbaseCharge(o) {
  if (!CC_API_KEY) return null;
  if (ChargesCache.has(o.order_id)) return ChargesCache.get(o.order_id);

  const body = {
    name: `CHAINVERS ${o.order_id}`,
    description: o.description || "CHAINVERS objednávka",
    local_price: { amount: o.amount.toFixed(2), currency: o.currency || "EUR" },
    pricing_type: "fixed_price",
    metadata: { order_id: o.order_id, user_id: o.user_id },
  };

  const r = await fetch(`${CC_API_BASE}/charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CC-Api-Key": CC_API_KEY,
      "X-CC-Version": "2018-03-22",
    },
    body: JSON.stringify(body),
  });

  const txt = await r.text();
  let j = null;
  try {
    j = JSON.parse(txt);
  } catch {}
  if (!r.ok) {
    console.warn("[Coinbase Commerce] create error", r.status, txt.slice(0, 300));
    return null;
  }
  const url = j?.data?.hosted_url || null;
  if (url) ChargesCache.set(o.order_id, url);
  return url;
}

// ==========================================
// 7️⃣ POMOCNÉ FUNKCIE
// ==========================================
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRaw(req);
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readRaw(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(chunks);
}

function safeParseJSON(x) {
  if (!x || typeof x !== "string") return null;
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}