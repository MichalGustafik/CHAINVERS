// pages/api/stripe-webhook.js
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };
const seenEvents = new Set();

const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const CIRCLE_HEADERS = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function circlePayout({ amount, currency = "USDC" }) {
  const body = {
    idempotencyKey: uuid(),
    destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
    amount: { amount: String(amount), currency }, // USDC alebo EURC
    chain: process.env.PAYOUT_CHAIN || "BASE",
  };
  const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
    method: "POST",
    headers: CIRCLE_HEADERS,
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Circle payout failed: ${r.status} ${JSON.stringify(data)}`);
  return data?.data; // { id, status, ... }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const rawBody = Buffer.concat(chunks);
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (seenEvents.has(event.id)) return res.status(200).json({ received: true, deduped: true });
  seenEvents.add(event.id);

  try {
    const handled = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "payment_intent.succeeded",
    ]);
    if (handled.has(event.type)) {
      const obj = event.data.object || {};

      const isCheckoutSession = obj.object === "checkout.session";
      const paymentIntentId = isCheckoutSession
        ? obj.payment_intent
        : obj.id;

      const cents = isCheckoutSession
        ? obj.amount_total ?? 0
        : (obj.amount_received ?? obj.amount ?? 0);
      const amount = Number(cents) / 100;
      const currency = String(obj.currency ?? "eur").toUpperCase();

      if (!paymentIntentId || !Number.isFinite(amount)) {
        throw new Error("Missing payment intent data in Stripe webhook payload");
      }

      const metadata = obj.metadata || {};
      const confirmPayload = {
        paymentIntentId,
        crop_data: metadata.crop_data ?? null,
        user_address: metadata.user_address || null,
      };
      const splitPayload = { paymentIntentId, amount, currency };

      const splitchainUrl =
        process.env.SPLITCHAIN_URL
          || (process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}/api/splitchain`
                : "https://chainvers.vercel.app/api/splitchain");

      const useToken = process.env.CIRCLE_PAYOUT_CURRENCY || "USDC";
      const amountToToken = amount; // jednoduché 1:1 (EUR -> USDC číslo) – upravíš si podľa pricingu

      const tasks = [
        fetch("https://chainvers.free.nf/confirm_payment.php", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirmPayload),
        }).then(async (r) => ({ tag: "confirm_payment", ok: r.ok, status: r.status, body: (await r.text()).slice(0, 300) })),

        fetch(splitchainUrl, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(splitPayload),
        }).then(async (r) => ({ tag: "splitchain", ok: r.ok, status: r.status, body: (await r.text()).slice(0, 300) })),

        (async () => {
          try {
            const payout = await circlePayout({ amount: amountToToken, currency: useToken });
            return { tag: "circle_payout", ok: true, status: 200, body: JSON.stringify(payout).slice(0, 300) };
          } catch (e) {
            return { tag: "circle_payout", ok: false, status: 500, body: String(e?.message || e) };
          }
        })(),
      ];

      await Promise.allSettled(tasks);
      return res.status(200).json({ received: true });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(200).json({ received: true, warning: err?.message || String(err) });
  }
}
