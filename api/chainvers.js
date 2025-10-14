// chainvers.js

import Stripe from "stripe";
import crypto from "crypto"; // PRIDANÉ: pre Coinbase Advanced Trade podpis

// Node 18+: fetch je vstavaný; fallback pre istotu
if (typeof fetch === "undefined") {
  // @ts-ignore
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

export const config = { api: { bodyParser: false } };

// ==========================
// ENV premenné (TVOJE PÔVODNÉ)
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
// PRIDANÉ – CHAINVERS ORDERS + COINBASE
// ==========================
const CHAINVERS_ORDERS_TOKEN = process.env.CHAINVERS_ORDERS_TOKEN; // shared s accptpay.php

// Coinbase Commerce (predvyplnený payment link)
const CC_API_KEY  = process.env.COINBASE_COMMERCE_API_KEY || "";
const CC_API_BASE = "https://api.commerce.coinbase.com";

// Coinbase Advanced Trade (EUR→ETH + withdraw)
const CB_API_BASE       = "https://api.coinbase.com/api/v3/brokerage";
const CB_API_KEY        = process.env.COINBASE_API_KEY || "";
const CB_API_SECRET     = process.env.COINBASE_API_SECRET || "";
const CB_API_PASSPHRASE = process.env.COINBASE_API_PASSPHRASE || "";

const WITHDRAW_MODE      = process.env.WITHDRAW_MODE || "coinbase"; // 'coinbase' | 'self_custody'
const WITHDRAW_CHAIN     = process.env.WITHDRAW_CHAIN || "ethereum"; // napr. 'ethereum','base'
const WITHDRAW_VALUE_ETH = process.env.WITHDRAW_VALUE_ETH || "0.01"; // koľko ETH poslať

// Self-custody (ak nepoužiješ custodial withdraw)
const RPC_URL          = process.env.RPC_URL || "";
const PRIVATE_KEY      = process.env.PRIVATE_KEY || "";
const CONTRACT_ABI_STR = process.env.CONTRACT_ABI || ""; // JSON string ABI
const CONTRACT_FUNCTION= process.env.CONTRACT_FUNCTION || "deposit";

// ==========================
/* Lokálna pamäť payoutov (ephemeral) – PÔVODNÉ */
// ==========================
const PayoutDB = new Map();

// ==========================
// Hlavný router (PÔVODNÝ + PRIDANÉ AKCIE)
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

    // PRIDANÉ:
    if (action === "chainvers_orders") return chainversOrders(req, res);
    if (action === "splitchain")       return splitchain(req, res);

    return res.status(400).json({ error: "Unknown ?action=" });
  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ==========================
// 1️⃣ CREATE PAYMENT PROXY (PÔVODNÉ)
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
// 2️⃣ STRIPE SESSION STATUS (PÔVODNÉ)
// ==========================
async function stripeSessionStatus(req, res) {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

  const stripe = new Stripe(STRIPE_SECRET);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi = session.payment_intent?.id;
    the payment_status = session.payment_status;
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
// 3️⃣ STRIPE WEBHOOK → spusti Circle payout (PÔVODNÉ)
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
// 4️⃣ MANUÁLNY CIRCLE PAYOUT (PÔVODNÉ)
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
// 5️⃣ PAYOUT STATUS (PÔVODNÉ)
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
// HELPERS – Circle (Address Book workflow) (PÔVODNÉ)
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
// A) PRIDANÉ – CHAINVERS ORDERS (pre accptpay.php)
// ==========================
async function chainversOrders(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CHAINVERS_ORDERS_TOKEN || auth !== CHAINVERS_ORDERS_TOKEN) {
    return res.status(401).json({ ok:false, error:"bad_token" });
  }

  const body = await readJson(req);
  if (body?.kind !== "LIST_PENDING") return res.status(400).json({ ok:false, error:"bad_kind" });

  // 1) Načítaj posledné zaplatené Stripe Checkout Sessions (24h)
  let orders = [];
  if (STRIPE_SECRET) {
    try {
      const since = Math.floor(Date.now()/1000) - 24*3600;
      const list = await fetch(
        "https://api.stripe.com/v1/checkout/sessions?limit=20&expand[]=data.payment_intent&created[gte]="+since,
        { headers: { Authorization: `Bearer ${STRIPE_SECRET}` } }
      );
      const js = await list.json();
      orders = (js?.data || [])
        .filter((s) => s.payment_status === "paid")
        .map((s) => ({
          order_id: s.metadata?.order_id || s.id,
          user_id:  s.metadata?.user_id  || (s.customer_details?.email || "unknown"),
          amount:   Number(s.amount_total ? s.amount_total/100 : s.amount_subtotal/100 || 0),
          currency: String(s.currency || "eur").toUpperCase(),
          description: s.metadata?.description || "Order",
          target: s.metadata?.target ? safeParseJSON(s.metadata.target) : undefined,
        }));
    } catch (e) {
      console.warn("[chainversOrders] stripe load failed:", e?.message || e);
    }
  }

  // DEMO fallback (zapni, ak potrebuješ hneď niečo vidieť)
  if (!orders.length) {
    orders = [
      { order_id: 'demo-1001', user_id: 'user-42', amount: 29.9, currency: 'EUR', description: 'Poster A' },
      { order_id: 'demo-1002', user_id: 'user-99', amount: 12.5, currency: 'EUR', description: 'Sticker Pack' },
    ];
  }

  // 2) Coinbase Commerce charge pre každú objednávku (predvyplnená suma)
  const enriched = [];
  for (const o of orders) {
    const url = await createCoinbaseCharge(o).catch(()=>null);
    enriched.push({ ...o, coinbase_url: url || undefined });
  }

  return res.status(200).json({ ok:true, orders: enriched });
}

// Pomocník: Coinbase Commerce charge
async function createCoinbaseCharge(o) {
  if (!CC_API_KEY) return null;
  const body = {
    name:        `CHAINVERS ${o.order_id}`,
    description: o.description || "CHAINVERS order",
    local_price: { amount: o.amount.toFixed(2), currency: o.currency || "EUR" },
    pricing_type: "fixed_price",
    metadata: { order_id: o.order_id, user_id: o.user_id }
  };
  const r = await fetch(`${CC_API_BASE}/charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CC-Api-Key": CC_API_KEY,
      "X-CC-Version": "2018-03-22"
    },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  let j=null; try{ j=JSON.parse(txt);}catch{}
  if (!r.ok) {
    console.warn("[Coinbase Commerce] create error", r.status, txt.slice(0,300));
    return null;
  }
  return j?.data?.hosted_url || null;
}

// ==========================
// B) PRIDANÉ – SPLITCHAIN (Accept -> EUR→ETH -> send to contract)
// ==========================
async function splitchain(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  const body = await readJson(req);
  const { token, kind, order_id, amount, currency } = body || {};
  if (!token || token !== process.env.SPLITCHAIN_SHARED_TOKEN) {
    return res.status(401).json({ ok:false, error:"bad_token" });
  }
  if (kind !== "ORDER_ACCEPTED") return res.status(400).json({ ok:false, error:"bad_kind" });
  if (!amount || !currency) return res.status(400).json({ ok:false, error:"need_amount_currency" });
  if (String(currency).toUpperCase() !== "EUR") return res.status(400).json({ ok:false, error:"expected_EUR" });

  // 1) EUR -> ETH (market IOC)
  const buy = await cbPost("/orders", {
    product_id: "ETH-EUR",
    side: "BUY",
    order_configuration: { market_market_ioc: { quote_size: Number(amount).toFixed(2) } }
  });

  if (!buy.ok) {
    return res.status(502).json({ ok:false, step:"buy", status:buy.status, body: buy.json || buy.text });
  }

  // 2) on-chain send
  if (WITHDRAW_MODE === "coinbase") {
    const wd = await cbPost("/withdrawals/crypto", {
      amount: WITHDRAW_VALUE_ETH,   // jednoduché — môžeš dopočítať z fills/portfolio
      asset: "ETH",
      crypto_address: CONTRACT_ADDRESS,
      chain: WITHDRAW_CHAIN
    });
    if (!wd.ok) {
      return res.status(502).json({ ok:false, step:"withdraw", status:wd.status, body: wd.json || wd.text });
    }
    return res.status(200).json({ ok:true, mode:"coinbase", buy: buy.json, withdraw: wd.json });
  } else {
    if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ABI_STR) {
      return res.status(500).json({ ok:false, error:"self_custody_env_missing" });
    }
    const receipt = await selfCustodySendEther(WITHDRAW_VALUE_ETH).catch(e => ({ error: e?.message || String(e) }));
    if (receipt?.error) return res.status(500).json({ ok:false, step:"self_custody", error: receipt.error });
    return res.status(200).json({ ok:true, mode:"self_custody", buy: buy.json, tx: receipt });
  }
}

// Coinbase Advanced Trade – podpísané požiadavky
function cbHeaders(method, pathAndQuery, body) {
  const ts = Math.floor(Date.now()/1000).toString();
  const payload = ts + method.toUpperCase() + pathAndQuery + (body ? JSON.stringify(body) : "");
  const hmac = crypto.createHmac("sha256", CB_API_SECRET).update(payload).digest("hex");
  return {
    "CB-ACCESS-KEY": CB_API_KEY,
    "CB-ACCESS-SIGN": hmac,
    "CB-ACCESS-TIMESTAMP": ts,
    "CB-ACCESS-PASSPHRASE": CB_API_PASSPHRASE,
    "Content-Type": "application/json"
  };
}
async function cbPost(path, body) {
  const headers = cbHeaders("POST", path, body);
  const r = await fetch(`${CB_API_BASE}${path}`, { method:"POST", headers, body: JSON.stringify(body) });
  const t = await r.text(); let j=null; try{ j=JSON.parse(t);}catch{}
  return { ok: r.ok, status: r.status, json: j, tex