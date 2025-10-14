// /api/chainvers.js
// CHAINVERS – Vercel API pre InfinityFree (objednávky + Stripe + verejné zobrazenie paid orders)

import Stripe from "stripe";

// Node 18+: fetch je vstavaný; fallback pre istotu
if (typeof fetch === "undefined") {
  // @ts-ignore
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

// Vercel: kvôli Stripe Webhooku potrebujeme raw body
export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenné
// ==========================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC  = process.env.STRIPE_WEBHOOK_SECRET || ""; // ak nepoužívaš, môže byť prázdne

// InfinityFree URL (success/cancel pre Checkout)
const INF_FREE_URL = process.env.INF_FREE_URL || "https://chainvers.free.nf";

// Chránené čítanie (ak budeš chcieť používať Bearer variant)
const CHAINVERS_ORDERS_TOKEN  = process.env.CHAINVERS_ORDERS_TOKEN || "";
const SPLITCHAIN_SHARED_TOKEN  = process.env.SPLITCHAIN_SHARED_TOKEN || "";

// ==========================
// Hlavný router
// ==========================
export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  try {
    if (action === "ping")                return ping(req, res);
    if (action === "create_payment_proxy")return createPaymentProxy(req, res);
    if (action === "stripe_webhook")      return stripeWebhook(req, res);

    // 👉 to, čo teraz potrebuješ:
    if (action === "orders_public")       return ordersPublic(req, res);

    // Ďalšie (voliteľné) akcie:
    if (action === "chainvers_orders")    return chainversOrders(req, res); // Bearer
    if (action === "splitchain")          return splitchain(req, res);      // accept z IF

    return res.status(400).json({ ok:false, error:"unknown_action" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// ==========================
// ping
// ==========================
async function ping(req, res) {
  return res.status(200).json({ ok:true, now: new Date().toISOString() });
}

// ==========================
// 1) Stripe Checkout – create_payment_proxy
//    InfinityFree volá: POST /api/chainvers?action=create_payment_proxy
//    Body: { amount, currency, description, crop_data, user_address }
// ==========================
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body || {};

    if (!amount || !currency) {
      return res.status(400).json({ ok:false, error:"missing_amount_or_currency" });
    }

    const stripe = new Stripe(STRIPE_SECRET);
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

    return res.status(200).json({ ok:true, checkout_url: session.url });
  } catch (err) {
    console.error("[createPaymentProxy] error", err);
    return res.status(500).json({ ok:false, error: err?.message || String(err) });
  }
}

// ==========================
// 2) Stripe Webhook (voliteľné – ak ho používaš)
// ==========================
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
  if (!STRIPE_WHSEC) return res.status(200).json({ ok:true, note:"webhook_secret_missing (noop)" });

  const stripe = new Stripe(STRIPE_SECRET);
  const rawBody = await readRaw(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WHSEC);
  } catch (err) {
    console.error("[stripeWebhook] bad signature:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    console.log("[stripeWebhook] ✅ paid:", s.id, s.payment_status);
  }

  return res.status(200).json({ ok:true, received:true });
}

// ==========================
// 3) PUBLIC ORDERS – bez tokenu, len uskutočnené (paid) objednávky
//    GET/POST /api/chainvers?action=orders_public
// ==========================
async function ordersPublic(req, res) {
  try {
    const stripe = new Stripe(STRIPE_SECRET);
    const since = Math.floor(Date.now()/1000) - 7*24*3600; // posledných 7 dní

    const sessions = await stripe.checkout.sessions.list({
      limit: 50,
      expand: ["data.payment_intent"],
      created: { gte: since },
    });

    const orders = (sessions?.data || [])
      .filter(s =>
        s?.payment_status === "paid" && s?.status !== "expired" && s?.status !== "canceled"
      )
      .map(s => ({
        order_id: s.id,
        user_id:  s?.metadata?.user_id || (s?.customer_details?.email ?? "unknown"),
        amount:   (s?.amount_total ?? 0) / 100,
        currency: String(s?.currency || "eur").toUpperCase(),
        description: s?.metadata?.description ?? "CHAINVERS objednávka",
      }));

    return res.status(200).json({ ok:true, orders });
  } catch (e) {
    console.error("[orders_public] fail:", e?.message || e);
    return res.status(500).json({ ok:false, error:"stripe_error" });
  }
}
// ==========================
// 4) PRIVATE ORDERS – chránené Bearer tokenom
//    POST /api/chainvers?action=chainvers_orders
//    Header: Authorization: Bearer <CHAINVERS_ORDERS_TOKEN>
//    Body:   { kind: "LIST_PENDING" }
// ==========================
async function chainversOrders(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // Overenie tokenu
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CHAINVERS_ORDERS_TOKEN || auth !== CHAINVERS_ORDERS_TOKEN) {
    return res.status(401).json({ ok: false, error: "bad_token" });
  }

  // (voliteľné) validácia payloadu
  const body = await readJson(req);
  if (!body || body.kind !== "LIST_PENDING") {
    return res.status(400).json({ ok: false, error: "bad_kind" });
  }

  try {
    const stripe = new Stripe(STRIPE_SECRET);
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;

    const sessions = await stripe.checkout.sessions.list({
      limit: 50,
      expand: ["data.payment_intent"],
      created: { gte: since },
    });

    // vrátime len zaplatené a nie canceled/expired
    const orders = (sessions?.data || [])
      .filter(
        (s) =>
          s?.payment_status === "paid" &&
          s?.status !== "expired" &&
          s?.status !== "canceled"
      )
      .map((s) => ({
        order_id: s.id,
        user_id: s?.metadata?.user_id || s?.customer_details?.email || "unknown",
        amount: (s?.amount_total ?? 0) / 100,
        currency: String(s?.currency || "eur").toUpperCase(),
        description: s?.metadata?.description ?? "CHAINVERS objednávka",
      }));

    return res.status(200).json({ ok: true, orders });
  } catch (e) {
    console.error("[chainvers_orders] fail:", e?.message || e);
    return res.status(500).json({ ok: false, error: "stripe_error" });
  }
}

// === koniec ČASTI 1/2 ===
// Pokračuj na ČASŤ 2/2 (splitchain + helpers: readJson/readRaw/safeParseJSON/uuid/…)

// === ČASŤ 2/2 — pokračovanie CHAINVERS API ===

// ==========================
// 5) SPLITCHAIN – prijatie potvrdenia z IF (len log / echo)
//    POST /api/chainvers?action=splitchain
//    Body: { kind:"ORDER_ACCEPTED", order_id, user_id, amount, currency, token }
// ==========================
async function splitchain(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = await readJson(req);
  const { token, kind, order_id, user_id, amount, currency } = body || {};

  // ak máš nastavený shared token, vyžaduj ho
  if (SPLITCHAIN_SHARED_TOKEN && token !== SPLITCHAIN_SHARED_TOKEN) {
    return res.status(401).json({ ok: false, error: "bad_token" });
  }
  if (kind !== "ORDER_ACCEPTED") {
    return res.status(400).json({ ok: false, error: "bad_kind" });
  }

  // tu by šli tvoje akcie (napr. kúpa krypto / odoslanie atď.)
  console.log("[splitchain] ✅ ACCEPTED:", { order_id, user_id, amount, currency });

  return res.status(200).json({
    ok: true,
    received: { order_id, user_id, amount, currency },
    note: "Splitchain OK (demo). Sem pripoj ďalšie kroky – napr. konverziu a odoslanie.",
  });
}

// ==========================
// Pomocné funkcie
// ==========================
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRaw(req);
  try {
    return JSON.parse(raw.toString("utf8"));
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

// === koniec ČASTI 2/2 ===