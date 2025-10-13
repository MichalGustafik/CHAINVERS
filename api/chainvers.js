import Stripe from "stripe";

// V Node 18+ je fetch vstavaný, ale pre istotu fallback:
if (typeof fetch === "undefined") {
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenné
// ==========================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// InfinityFree doména, kam sa má Stripe po platbe vrátiť
const INF_FREE_URL = "https://chainvers.free.nf";

// ==========================
// Lokálna pamäť pre payouty
// ==========================
const PayoutDB = new Map();

// ==========================
// Hlavný router
// ==========================
export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  try {
    if (action === "create_payment_proxy") return createPaymentProxy(req, res);
    if (action === "stripe_session_status") return stripeSessionStatus(req, res);
    if (action === "stripe_webhook") return stripeWebhook(req, res);
    if (action === "payout_status") return payoutStatus(req, res);
    if (action === "circle_payout") return circlePayout(req, res);
    if (action === "ping") return res.status(200).json({ ok: true, now: new Date().toISOString() });

    return res.status(400).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ==========================
// 1️⃣ CREATE PAYMENT PROXY
// ==========================
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Missing amount or currency" });
    }

    const stripe = new Stripe(STRIPE_SECRET);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
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
      // ✅ Po platbe sa užívateľ vráti na InfinityFree
      success_url: `${INF_FREE_URL}/thankyou.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${INF_FREE_URL}/index.php`,
    });

    return res.status(200).json({ checkout_url: session.url });
  } catch (err) {
    console.error("[createPaymentProxy] error", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ==========================
// 2️⃣ STRIPE SESSION STATUS
// ==========================
async function stripeSessionStatus(req, res) {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  const stripe = new Stripe(STRIPE_SECRET);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const pi = session.payment_intent?.id;
    const payment_status = session.payment_status;
    const metadata = session.metadata || {};

    return res.status(200).json({
      id: session.id,
      payment_status,
      payment_intent: pi,
      metadata,
    });
  } catch (e) {
    console.error("[stripeSessionStatus] error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ==========================
// 3️⃣ STRIPE WEBHOOK
// ==========================
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(STRIPE_SECRET);
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const rawBody = Buffer.concat(chunks);

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

  const s = event.data.object;
  const pi = s.payment_intent;
  const amount = (s.amount_total ?? 0) / 100;
  const currency = (s.currency ?? "eur").toUpperCase();

  PayoutDB.set(pi, {
    payoutId: null,
    status: "queued",
    amount,
    currency,
    updatedAt: Date.now(),
  });

  triggerCirclePayout(pi, amount, currency).catch(console.error);
  return res.status(200).json({ received: true });
}

// ==========================
// 4️⃣ CIRCLE PAYOUT
// ==========================
async function circlePayout(req, res) {
  const body = await readJson(req);
  const amount = body.amount;
  const currency = body.currency || "USDC";
  const address = body.to || CONTRACT_ADDRESS;

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address },
    amount: { amount: String(amount), currency },
    chain: PAYOUT_CHAIN,
  };

  const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CIRCLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const txt = await r.text();
  let j = null;
  try {
    j = JSON.parse(txt);
  } catch {}
  if (!r.ok) return res.status(r.status).json({ ok: false, error: j || txt });
  return res.status(200).json({ ok: true, result: j?.data || j });
}

// ==========================
// 5️⃣ PAYOUT STATUS
// ==========================
async function payoutStatus(req, res) {
  const pi = req.query.pi;
  if (!pi) return res.status(400).json({ error: "Missing ?pi" });

  const local = PayoutDB.get(pi);
  if (!local) return res.status(200).json({ ok: true, state: "unknown" });

  if (local.payoutId) {
    try {
      const r = await fetch(`${CIRCLE_BASE}/v1/payouts/${local.payoutId}`, {
        headers: { Authorization: `Bearer ${CIRCLE_API_KEY}` },
      });
      const txt = await r.text();
      let j = null;
      try {
        j = JSON.parse(txt);
      } catch {}
      if (r.ok) local.status = j?.data?.status || local.status;
      PayoutDB.set(pi, { ...local, updatedAt: Date.now() });
    } catch {}
  }

  return res.status(200).json({
    ok: true,
    state: local.status,
    payoutId: local.payoutId || null,
    amount: local.amount,
    currency: local.currency,
  });
}

// ==========================
// HELPERS
// ==========================
async function triggerCirclePayout(pi, amount, currency) {
  try {
    const payload = {
      idempotencyKey: uuid(),
      destination: { type: "crypto", address: CONTRACT_ADDRESS },
      amount: { amount: String(amount), currency: "USDC" },
      chain: PAYOUT_CHAIN,
    };
    const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CIRCLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    if (!r.ok) throw new Error(txt);
    const data = j?.data || j;
    PayoutDB.set(pi, {
      payoutId: data.id,
      status: data.status || "created",
      amount,
      currency,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("[triggerCirclePayout]", e);
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}