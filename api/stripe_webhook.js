// /api/stripe-webhook.js
import Stripe from "stripe";

// Stripe potrebuje RAW body kvôli verifikácii podpisu
export const config = { api: { bodyParser: false } };

// jednoduchý (in-memory) idempotency guard – do produkcie zvaž Redis/KV/DB
const seenEvents = new Set();

// ---- Circle helpers ----
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const CIRCLE_HEADERS = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// vytvor payout USDC/EURC na address_book recipienta (id = CIRCLE_ADDRESS_BOOK_ID)
async function circlePayout({ amount, currency = "USDC" }) {
  const body = {
    idempotencyKey: uuid(),
    destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
    amount: { amount: String(amount), currency }, // "USDC" alebo "EURC"
    chain: process.env.PAYOUT_CHAIN || "BASE",    // BASE, ETH, MATIC, ...
  };

  const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
    method: "POST",
    headers: CIRCLE_HEADERS,
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`Circle payout failed: ${r.status} ${JSON.stringify(data)}`);
  }
  return data?.data; // { id, status, ... }
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  console.log("➡️  [WEBHOOK] Incoming", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
    sig: !!req.headers["stripe-signature"],
  });

  if (req.method !== "POST") {
    console.warn("⚠️  [WEBHOOK] Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // načítaj RAW body
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const rawBody = Buffer.concat(chunks);
    console.log("📦  [WEBHOOK] Raw body", { bytes: rawBody.length });

    // over podpis
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    console.log("✅  [WEBHOOK] Signature OK", {
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      apiVersion: event.api_version,
    });
  } catch (err) {
    console.error("❌  [WEBHOOK] Signature failed", { message: err?.message, stack: err?.stack });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // idempotencia (ochrana pri retri)
  if (seenEvents.has(event.id)) {
    console.log("♻️  [WEBHOOK] Deduped event", { eventId: event.id });
    return res.status(200).json({ received: true, deduped: true });
  }
  seenEvents.add(event.id);

  try {
    // pokrývame okamžité aj asynchrónne úspešné platby
    const handledTypes = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);

    if (handledTypes.has(event.type)) {
      const session = event.data.object;

      const paymentIntentId = session.payment_intent;
      const amount = (session.amount_total ?? 0) / 100; // Stripe centy → mena
      const currency = (session.currency ?? "eur").toUpperCase();

      // metadata
      let user_address = session.metadata?.user_address || null;
      let crop_data = session.metadata?.crop_data ?? null;
      try {
        if (typeof crop_data === "string") crop_data = JSON.parse(crop_data);
      } catch {
        console.warn("⚠️  [WEBHOOK] crop_data JSON parse failed – leaving raw string");
      }

      console.log("🧾  [WEBHOOK] Session OK", {
        eventType: event.type,
        session_id: session.id,
        paymentIntentId,
        amount,
        currency,
        has_metadata: !!session.metadata,
      });

      // URL pre Splitchain – preferuj ENV, inak aktuálny deployment, inak fallback
      const splitchainUrl =
        process.env.SPLITCHAIN_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/splitchain`
          : "https://chainvers.vercel.app/api/splitchain");

      // payloady
      const confirmPayload = { paymentIntentId, crop_data, user_address };
      const splitPayload = { paymentIntentId, amount, currency };

      console.log("📤  [WEBHOOK] → IF confirm_payment.php", confirmPayload);
      console.log("📤  [WEBHOOK] → Vercel /api/splitchain", { url: splitchainUrl, ...splitPayload });

      // --- CIRCLE payout po úspešnej platbe (EUR -> USDC mapping 1:1 na štart) ---
      const useToken = process.env.CIRCLE_PAYOUT_CURRENCY || "USDC"; // alebo "EURC"
      const amountToToken = amount; // jednoduchý mapping 1:1; neskôr si spravíš presný pricing/FX
      console.log("💸  [WEBHOOK] Circle payout request", {
        addressBookId: process.env.CIRCLE_ADDRESS_BOOK_ID,
        chain: process.env.PAYOUT_CHAIN || "BASE",
        currency: useToken,
        amount: amountToToken,
      });

      const results = await Promise.allSettled([
        // 1) IF confirm (PHP)
        fetch("https://chainvers.free.nf/confirm_payment.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmPayload),
        }).then(async (r) => ({
          tag: "confirm_payment",
          ok: r.ok,
          status: r.status,
          body: (await r.text()).slice(0, 500),
        })),

        // 2) Splitchain (tvoja interná logika)
        fetch(splitchainUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(splitPayload),
        }).then(async (r) => ({
          tag: "splitchain",
          ok: r.ok,
          status: r.status,
          body: (await r.text()).slice(0, 500),
        })),

        // 3) Circle payout
        (async () => {
          try {
            const payout = await circlePayout({ amount: amountToToken, currency: useToken });
            return { tag: "circle_payout", ok: true, status: 200, body: JSON.stringify(payout).slice(0, 500) };
          } catch (e) {
            return { tag: "circle_payout", ok: false, status: 500, body: String(e?.message || e) };
          }
        })(),
      ]);

      results.forEach((r) => {
        if (r.status === "fulfilled") {
          console.log(`📥  [WEBHOOK] ${r.value.tag} response`, {
            ok: r.value.ok,
            status: r.value.status,
            body_preview: r.value.body,
          });
        } else {
          console.error("🚨  [WEBHOOK] Task failed", { reason: r.reason });
        }
      });

      console.log("✅  [WEBHOOK] Done", { eventId: event.id, ms: Date.now() - startedAt });
      return res.status(200).json({ received: true });
    }

    console.log("ℹ️  [WEBHOOK] Unhandled type", { type: event.type, id: event.id });
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("🚨  [WEBHOOK] Handler error", { message: err?.message, stack: err?.stack, eventId: event?.id });
    return res.status(200).json({ received: true, warning: "internal error logged" });
  }
}
