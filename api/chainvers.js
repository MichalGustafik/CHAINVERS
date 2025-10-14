// pages/api/chainvers.js
import Stripe from "stripe";

// Node 18+: fetch je vstavaný; fallback pre istotu
if (typeof fetch === "undefined") {
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

export const config = { api: { bodyParser: false } };

/* =========================
   ENV (potrebné na Verceli)
   =========================
   STRIPE_SECRET_KEY
   STRIPE_WEBHOOK_SECRET

   // TrueLayer:
   TRUELAYER_CLIENT_ID
   TRUELAYER_CLIENT_SECRET

   // Tvoja cieľová IBAN/účet (kam TL pošle €) – dočasne bankový účet,
   // následne si to zmeníš na onramp/crypto účet (Coinbase Business, atď.)
   BENEFICIARY_IBAN
   BENEFICIARY_NAME    (napr. "Chainvers Treasury")

   // (voliteľné) Logovanie:
   DEBUG_TL=true
*/

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WHSEC  = process.env.STRIPE_WEBHOOK_SECRET;

const TL_CLIENT_ID     = process.env.TRUELAYER_CLIENT_ID;
const TL_CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET;

// pevne v kóde (ako si chcel) – NECHODÍ do ENV
const TL_REDIRECT_URI  = "https://chainvers.vercel.app/api/chainvers?action=truelayer_callback";

const BENEFICIARY_IBAN = process.env.BENEFICIARY_IBAN || "LT00TEST000000000000"; // uprav si
const BENEFICIARY_NAME = process.env.BENEFICIARY_NAME || "Chainvers Treasury";

const INF_FREE_URL = "https://chainvers.free.nf";

// jednoduchá pamäť
const PayoutDB = new Map();
const TLTokenDB = new Map(); // mapovanie user/session → TL tokens (demo)

// ==========================
// Router
// ==========================
export default async function handler(req, res) {
  const action = String(req.query?.action || "").toLowerCase();

  try {
    if (action === "create_payment_proxy") return createPaymentProxy(req, res);
    if (action === "stripe_session_status") return stripeSessionStatus(req, res);
    if (action === "stripe_webhook") return stripeWebhook(req, res);

    // TrueLayer:
    if (action === "truelayer_link") return truelayerLink(req, res);
    if (action === "truelayer_callback") return truelayerCallback(req, res);
    if (action === "truelayer_pay") return truelayerPay(req, res);

    if (action === "ping") return res.status(200).json({ ok: true, now: new Date().toISOString() });

    return res.status(400).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ==========================
// Stripe – Create Checkout Session (proxy)
// ==========================
async function createPaymentProxy(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = await readJson(req);
    const { amount, currency, description, crop_data, user_address } = body;

    if (!amount || !currency) return res.status(400).json({ error: "Missing amount or currency" });

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
// Stripe – Session Status (pre thankyou.php na IF)
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
// Stripe – Webhook: po úspešnej platbe spustíme TL platbu € (automatizácia)
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

  // 1) ihneď zapíš na IF
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

  // 2) automaticky spusti TL platbu (ak máme uložený TL access_token pre tvoj účet)
  // Pozn.: V produkcii si mapuj používateľa/systémový účet → access_token.
  const systemKey = "SYSTEM"; // demo – jeden spoločný účet Revolut
  const tlTokens = TLTokenDB.get(systemKey);
  if (tlTokens?.access_token) {
    try {
      const tl = await tlCreateImmediatePayment(tlTokens.access_token, {
        amountEUR: amount, // uprav si percento/rozpad podľa logiky
        iban: BENEFICIARY_IBAN,
        name: BENEFICIARY_NAME,
        reference: `CHAINVERS ${pi}`,
      });
      console.log("[TL payment] ok", tl);
      PayoutDB.set(pi, { status: "tl_initiated", tl_payment_id: tl?.id || tl?.result?.id || null, amount, currency, at: Date.now() });
    } catch (e) {
      console.error("[TL payment] failed", e?.message || e);
      PayoutDB.set(pi, { status: "tl_failed", error: e?.message || String(e), amount, currency, at: Date.now() });
    }
  } else {
    console.warn("[TL payment] skipped – no access_token yet (spusť /api/chainvers?action=truelayer_link a prepoj Revolut).");
  }

  return res.status(200).json({ received: true });
}

// ==========================
// TrueLayer – 1) LINK (autorizácia Revolut účtu)
// ==========================
async function truelayerLink(req, res) {
  if (!TL_CLIENT_ID || !TL_CLIENT_SECRET) {
    return res.status(500).json({ error: "Missing TRUELAYER_CLIENT_ID/TRUELAYER_CLIENT_SECRET" });
  }

  const auth = new URL("https://auth.truelayer.com/");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", TL_CLIENT_ID);
  auth.searchParams.set("scope", "accounts balance transactions direct_debits cards payments");
  auth.searchParams.set("redirect_uri", TL_REDIRECT_URI);         // pevne v kóde
  auth.searchParams.set("providers", "revolut");                   // konkrétne Revolut
  auth.searchParams.set("state", "chainvers_state");               // doplň si CSRF ochranu ak chceš
  // auth.searchParams.set("enable_mock", "true");                 // sandbox, ak používaš mock provider

  // presmeruj používateľa do Rev/TrueLayer OAuth
  return res.redirect(auth.toString());
}

// ==========================
// TrueLayer – 2) CALLBACK (výmena code → access_token)
// ==========================
async function truelayerCallback(req, res) {
  const code = req.query?.code;
  if (!code) return res.status(400).send("Missing ?code");

  const tokenRes = await fetch("https://auth.truelayer.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: TL_CLIENT_ID,
      client_secret: TL_CLIENT_SECRET,
      redirect_uri: TL_REDIRECT_URI, // pevne v kóde
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (process.env.DEBUG_TL === "true") console.log("[TL token] ", tokenData);

  if (!tokenRes.ok) {
    return res.status(tokenRes.status).send(`TL token error: ${JSON.stringify(tokenData)}`);
  }

  // demo: uložíme pod "SYSTEM" – v produkcii viaž na konkrétneho používateľa
  TLTokenDB.set("SYSTEM", {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    token_type: tokenData.token_type,
    expires_in: tokenData.expires_in,
    obtained_at: Date.now(),
  });

  // jednoduchá spätná stránka
  return res.status(200).send("TrueLayer prepojené ✔ – teraz môžeš spúšťať platby.");
}

// ==========================
// TrueLayer – 3) manuálna platba (na test)
// POST { amount: number }
// ==========================
async function truelayerPay(req, res) {
  const body = await readJson(req);
  const amount = Number(body?.amount || 0);
  if (!amount) return res.status(400).json({ error: "Missing amount" });

  const tl = TLTokenDB.get("SYSTEM");
  if (!tl?.access_token) return res.status(400).json({ error: "TrueLayer not linked – open /api/chainvers?action=truelayer_link" });

  try {
    const out = await tlCreateImmediatePayment(tl.access_token, {
      amountEUR: amount,
      iban: BENEFICIARY_IBAN,
      name: BENEFICIARY_NAME,
      reference: `CHAINVERS manual ${Date.now()}`,
    });
    return res.status(200).json({ ok: true, result: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

/* =========================
   TrueLayer helpers
   ========================= */
async function tlCreateImmediatePayment(accessToken, { amountEUR, iban, name, reference }) {
  // amount v minor units (centy)
  const amount_in_minor = Math.round(Number(amountEUR) * 100);

  const payload = {
    amount_in_minor,
    currency: "EUR",
    beneficiary: {
      type: "external_account",
      account_holder_name: name,
      account_identifier: { type: "iban", iban },
      reference: reference?.slice(0, 18) || "CHAINVERS", // bankové referencie majú limity
    },
  };

  if (process.env.DEBUG_TL === "true") console.log("[TL pay →]", payload);

  const r = await fetch("https://pay-api.truelayer.com/single-immediate-payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch {}
  if (process.env.DEBUG_TL === "true") console.log("[TL pay ←]", r.status, txt.slice(0, 800));

  if (!r.ok) throw new Error(`TL payment failed: ${r.status} ${txt}`);
  return json;
}

/* =========================
   Util
   ========================= */
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

function safeParseJSON(x) { if (!x || typeof x !== "string") return null; try { return JSON.parse(x); } catch { return null; } }