// /api/chainvers.js  
// CHAINVERS – Vercel API pre InfinityFree (objednávky + Stripe + verejné zobrazenie paid sessions)

import Stripe from "stripe";

// Node 18+: fetch je vstavaný; fallback pre istotu
if (typeof fetch === "undefined") {
  // @ts-ignore
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

// kvôli Stripe Webhooku – zakázaný bodyParser
export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenné
// ==========================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;  // musí začínať "sk_"
const STRIPE_WHSEC  = process.env.STRIPE_WEBHOOK_SECRET || "";
const INF_FREE_URL  = process.env.INF_FREE_URL || "https://chainvers.free.nf";

// ==========================
// Hlavný router
// ==========================
export default async function handler(req, res) {
  const action = (req.query?.action || "").toString().toLowerCase();

  try {
    if (action === "ping")                return ping(req, res);
    if (action === "orders_public")       return ordersPublic(req, res);

    // (voliteľné) budúce akcie:
    // if (action === "create_payment_proxy") return createPaymentProxy(req, res);
    // if (action === "stripe_webhook") return stripeWebhook(req, res);

    return res.status(400).json({ ok:false, error:"unknown_action" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

// ==========================
// ping – na wakeup z InfinityFree
// ==========================
async function ping(req, res) {
  return res.status(200).json({ ok:true, now:new Date().toISOString() });
}

// ==========================
// 1️⃣ orders_public – zobrazí zaplatené sessiony zo Stripe
// ==========================
async function ordersPublic(req, res) {
  try {
    if (!STRIPE_SECRET || !STRIPE_SECRET.startsWith("sk_")) {
      console.error("[orders_public] ❌ STRIPE_SECRET_KEY chýba alebo nie je sk_");
      return res.status(500).json({ ok:false, error:"missing_stripe_secret_key" });
    }

    const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2024-06-20" });

    // posledných 7 dní
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

    console.log(`[orders_public] ✅ Načítaných ${paid.length} zaplatených sessionov`);
    return res.status(200).json({ ok:true, count: paid.length, orders: paid });
  } catch (err) {
    console.error("[orders_public] ERROR", err);
    return res.status(500).json({
      ok:false,
      error:"stripe_error",
      message: err?.message || String(err),
    });
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
// TEST ENDPOINTY (voliteľné)
// ==========================
// https://chainvers.vercel.app/api/chainvers?action=ping
// https://chainvers.vercel.app/api/chainvers?action=orders_public
// ==========================

