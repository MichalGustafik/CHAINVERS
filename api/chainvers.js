import Stripe from "stripe";

// Node 18+: fetch je vstavaný; fallback pre istotu
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

// InfinityFree doména (kam sa Stripe po platbe vracia aj kam logujeme)
const INF_FREE_URL = "https://chainvers.free.nf";

// Voliteľné: ak už máš uložený recipient v Address Booku
let CACHED_RECIPIENT_ID = process.env.CIRCLE_ADDRESS_BOOK_ID || null;

// ==========================
// Lokálna pamäť payoutov (ephemeral)
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
    if (action === "circle_payout") return circlePayout(req, res); // manuálne testovanie
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

// ==========================
// 2️⃣ STRIPE SESSION STATUS (pre thankyou.php na IF)
// ==========================
async function stripeSessionStatus(req, res) {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  const stripe = new Stripe(STRIPE_SECRET);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
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
// 3️⃣ STRIPE WEBHOOK → spusti Circle payout
// ==========================
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(STRIPE_SECRET);
  const rawBody = await readRaw(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WHSEC);
  } catch (err) {
    console.error("[stripeWebhook] bad signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const okTypes = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
  if (!okTypes.has(event.type)) return res.status(200).json({ received: true });

  const s = event.data.object; // checkout.session
  const pi = s.payment_intent;
  const amount = (s.amount_total ?? 0) / 100;
  const currency = (s.currency ?? "eur").toUpperCase();
  const metadata = s.metadata || {};

  // 3.1) Zapíš na IF — aby mal IF hneď sumu/stav
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

  // 3.2) Ulož lokálne a spusti Circle payout (fire-and-forget)
  PayoutDB.set(pi, {
    payoutId: null,
    status: "queued",
    amount,
    currency,
    updatedAt: Date.now(),
  });

  triggerCirclePayout(pi, amount, currency).catch((e) => {
    console.error("[triggerCirclePayout] failed", e?.message || e);
  });

  return res.status(200).json({ received: true });
}

// ==========================
// 4️⃣ MANUÁLNY CIRCLE PAYOUT (na test)
// ==========================
async function circlePayout(req, res) {
  const body = await readJson(req);
  const amount = body.amount;
  const currency = body.currency || "USDC"; // Circle = token (USDC/EURC)
  const address = body.to || CONTRACT_ADDRESS;

  if (!address) return res.status(400).json({ error: "Missing CONTRACT_ADDRESS/to" });
  if (!amount) return res.status(400).json({ error: "Missing amount" });

  try {
    const recipientId = await ensureAddressBookRecipient(address);
    const payload = {
      idempotencyKey: uuid(),
      destination: { type: "address_book", id: recipientId },
      amount: { amount: String(amount), currency },
      chain: PAYOUT_CHAIN,
    };

    console.log("[Circle payout] →", payload);

    const r = await circleFetch("/v1/payouts", { method: "POST", body: payload });
    console.log("[Circle payout] ←", r.status, JSON.stringify(r.json).slice(0, 500));

    if (!r.ok) return res.status(r.status).json({ ok: false, error: r.json || r.text });
    return res.status(200).json({ ok: true, result: r.json?.data || r.json });
  } catch (e) {
    console.error("[circlePayout] failed", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

// ==========================
// 5️⃣ PAYOUT STATUS
// ==========================
async function payoutStatus(req, res) {
  const pi = req.query.pi;
  if (!pi) return res.status(400).json({ error: "Missing ?pi" });

  const local = PayoutDB.get(pi);
  if (!local) return res.status(200).json({ ok: true, state: "unknown" });

  // ak poznáme payoutId, skúsime živý stav z Circle
  if (local.payoutId) {
    try {
      const r = await circleFetch(`/v1/payouts/${local.payoutId}`);
      if (r.ok) local.status = (r.json?.data?.status || local.status);
      PayoutDB.set(pi, { ...local, updatedAt: Date.now() });
    } catch (e) {
      console.warn("[payout_status] circle fetch failed:", e?.message || e);
    }
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
// HELPERS – Circle (Address Book workflow)
// ==========================
async function ensureAddressBookRecipient(address) {
  if (!CIRCLE_API_KEY) throw new Error("Missing CIRCLE_API_KEY");
  if (!address) throw new Error("Missing destination address (CONTRACT_ADDRESS)");

  // ak máme v ENV/cache, použi
  if (CACHED_RECIPIENT_ID) return CACHED_RECIPIENT_ID;

  // 1) create recipient
  const createBody = {
    idempotencyKey: uuid(),
    chain: PAYOUT_CHAIN,        // napr. "BASE"
    address,                    // tvoja kontrakt/EOA adresa
    metadata: { nickname: "Treasury", note: "CHAINVERS contract" },
  };
  const createRes = await circleFetch("/v1/addressBook/recipients", { method: "POST", body: createBody });
  if (!createRes.ok) {
    throw new Error(`Circle AddressBook create failed: ${JSON.stringify(createRes.json || createRes.text)}`);
  }
  const recipientId = createRes.json?.data?.id;
  let status = createRes.json?.data?.status || "unknown";
  console.log("[Circle AddressBook] created", { recipientId, status });

  // 2) poll status → active
  const start = Date.now();
  const timeoutMs = 60_000;    // 60s
  const intervalMs = 2_000;    // 2s
  while (status !== "active" && Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const getRes = await circleFetch(`/v1/addressBook/recipients/${recipientId}`);
    if (!getRes.ok) throw new Error(`Circle AddressBook get failed: ${JSON.stringify(getRes.json || getRes.text)}`);
    status = getRes.json?.data?.status || status;
    console.log("[Circle AddressBook] poll", { recipientId, status });
  }
  if (status !== "active") {
    throw new Error(`Recipient not active after polling (${status})`);
  }

  // cache + hint (skopíruj si do ENV, nech to neriešime znova)
  CACHED_RECIPIENT_ID = recipientId;
  console.log(`[Circle AddressBook] ACTIVE id=${recipientId}  ➜ Ulož do Vercel ENV: CIRCLE_ADDRESS_BOOK_ID=${recipientId}`);
  return recipientId;
}

async function triggerCirclePayout(pi, amount /* number */, currencyFromStripe /* "EUR"|... */) {
  if (!CONTRACT_ADDRESS) throw new Error("Missing CONTRACT_ADDRESS");

  // 1) Ensure recipient
  const recipientId = await ensureAddressBookRecipient(CONTRACT_ADDRESS);

  // 2) Create payout (USDC/EURC token – uprav si podľa reality)
  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "address_book", id: recipientId },
    amount: { amount: String(amount), currency: "USDC" },
    chain: PAYOUT_CHAIN,
  };

  console.log("[Circle trigger] →", payload);

  const r = await circleFetch("/v1/payouts", { method: "POST", body: payload });
  console.log("[Circle trigger] ←", r.status, JSON.stringify(r.json || r.text).slice(0, 500));

  if (!r.ok) {
    throw new Error(`Circle payout failed: ${r.status} ${JSON.stringify(r.json || r.text)}`);
  }

  const data = r.json?.data || r.json;
  // ulož lokálne mapovanie pre payout_status
  const prev = PayoutDB.get(pi) || {};
  PayoutDB.set(pi, {
    ...prev,
    payoutId: data.id,
    status: data.status || "created",
    amount,
    currency: currencyFromStripe,
    updatedAt: Date.now(),
  });

  // (voliteľne) pošli update na IF
  try {
    await fetch(`${INF_FREE_URL}/confirm_payment.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentIntentId: pi,
        circle_payout_id: data.id,
        circle_status: data.status || "created",
        ts: Date.now(),
        source: "circle_trigger",
      }),
    });
  } catch {}
}

// ==========================
// Generic helpers
// ==========================
async function circleFetch(path, { method = "GET", body } = {}) {
  const url = `${CIRCLE_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${CIRCLE_API_KEY}`,
    "Content-Type": "application/json",
  };
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (process.env.DEBUG_CIRCLE === "true") {
    console.log("[circle] req", method, url, "payload:", body);
    console.log("[circle] res", res.status, text.slice(0, 800));
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRaw(req);
  try { return JSON.parse(raw); } catch { return {}; }
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}