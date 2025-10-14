// /api/chainvers.js
// CHAINVERS – Stripe webhook + načítanie zaplatených objednávok + zápis do InfinityFree

import Stripe from "stripe";

// Node 18+: fetch je vstavaný; fallback pre istotu
if (typeof fetch === "undefined") {
  // @ts-ignore
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenné
// ==========================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC  = process.env.STRIPE_WEBHOOK_SECRET || "";
const INF_FREE_URL  = process.env.INF_FREE_URL || "https://chainvers.free.nf";

// ==========================
// Hlavný router
// ==========================
export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  try {
    if (action === "ping")           return ping(req, res);
    if (action === "orders_public")  return ordersPublic(req, res);
    if (action === "stripe_webhook") return stripeWebhook(req, res);

    return res.status(400).json({ ok:false, error:"unknown_action" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// ==========================
// Ping (na prebudenie z InfinityFree)
// ==========================
async function ping(req, res) {
  return res.status(200).json({ ok:true, now:new Date().toISOString() });
}

// ==========================
// 1️⃣ STRIPE WEBHOOK – po úspešnej platbe uloží dáta na InfinityFree
// ==========================
async function stripeWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });
  if (!STRIPE_WHSEC) return res.status(200).json({ ok:true, note:"webhook_secret_missing" });

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
    const pi = s.payment_intent;
    const amount = (s.amount_total ?? 0) / 100;
    const currency = (s.currency ?? "eur").toUpperCase();
    const metadata = s.metadata || {};

    console.log("[stripeWebhook] ✅ PAID:", s.id, amount, currency);

    // 🔹 odoslať na InfinityFree → confirm_payment.php
    try {
      const payload = {
        paymentIntentId: pi,
        amount,
        currency,
        user_address: metadata.user_address || "unknown",
        crop_data: safeParseJSON(metadata.crop_data),
        status: "paid",
        ts: Date.now(),
        source: "stripe_webhook"
      };

      const r = await fetch(`${INF_FREE_URL}/confirm_payment.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const txt = await r.text();
      console.log(`[confirm_payment.php] → ${r.status}: ${txt.slice(0, 120)}`);
    } catch (err) {
      console.error("[confirm_payment] send failed", err);
    }
  }

  return res.status(200).json({ ok:true, received:true });
}

// ==========================
// 2️⃣ orders_public – vráti zoznam zaplatených objednávok
// ==========================
async function ordersPublic(req, res) {
  try {
    if (!STRIPE_SECRET || !STRIPE_SECRET.startsWith("sk_")) {
      return res.status(500).json({ ok:false, error:"Missing STRIPE_SECRET_KEY" });
    }

    const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2024-06-20" });
    const since = Math.floor(Date.now()/1000) - 7*24*3600;

    const sessions = await stripe.checkout.sessions.list({
      limit: 50,
      expand: ["data.payment_intent"],
      created: { gte: since },
    });

    const paid = (sessions?.data || [])
      .filter(s => s.payment_status === "paid" && s.status !== "expired" && s.status !== "canceled")
      .map(s => ({
        order_id: s.id,
        user_id:  s.metadata?.user_id || s.customer_details?.email || "unknown",
        amount:   (s.amount_total ?? 0) / 100,
        currency: String(s.currency || "eur").toUpperCase(),
        description: s.metadata?.description || "CHAINVERS objednávka",
        created_at: new Date(s.created * 1000).toISOString(),
      }));

    return res.status(200).json({ ok:true, count: paid.length, orders: paid });
  } catch (err) {
    console.error("[orders_public] ERROR", err);
    return res.status(500).json({ ok:false, error:"stripe_error", message:err?.message || String(err) });
  }
}

// ==========================
// Pomocné funkcie
// ==========================
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

// ==========================
// TEST ENDPOINTY
// ==========================
// 🔹 ping
// https://chainvers.vercel.app/api/chainvers?action=ping
// 🔹 orders_public
// https://chainvers.vercel.app/api/chainvers?action=orders_public
// 🔹 Stripe webhook
// nastav vo Stripe Dashboard:
// https://chainvers.vercel.app/api/chainvers?action=stripe_webhook