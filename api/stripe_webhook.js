// pages/api/stripe-webhook.js
import Stripe from "stripe";
import { runSplit } from "../shared/splitchain.js";
import { circlePayout } from "../shared/circle.js";

export const config = { api: { bodyParser: false } };
const seenEvents = new Set();

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
      const tasks = [
        fetch("https://chainvers.free.nf/confirm_payment.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmPayload),
        }).then(async (r) => ({
          tag: "confirm_payment",
          ok: r.ok,
          status: r.status,
          body: (await r.text()).slice(0, 300),
        })),

        (async () => {
          try {
            const result = await runSplit({ paymentIntentId, amount, currency });
            return { tag: "splitchain", ok: true, status: 200, body: JSON.stringify(result).slice(0, 300) };
          } catch (err) {
            return { tag: "splitchain", ok: false, status: 500, body: String(err?.message || err) };
          }
        })(),

        (async () => {
          const rawFraction = process.env.CIRCLE_PAYOUT_PERCENT ?? process.env.CIRCLE_PAYOUT_FRACTION;
          let fraction = 1;
          if (rawFraction) {
            const parsed = parseFloat(rawFraction);
            if (Number.isFinite(parsed) && parsed > 0) {
              fraction = parsed > 1 ? parsed / 100 : parsed;
            }
          }

          const payoutAmount = Number.isFinite(fraction) ? amount * Math.min(Math.max(fraction, 0), 1) : amount;
          if (payoutAmount <= 0 || !process.env.CIRCLE_API_KEY) {
            return { tag: "circle_payout", skipped: true, reason: "Circle payout disabled" };
          }

          try {
            const payout = await circlePayout({ amount: payoutAmount, currency });
            return { tag: "circle_payout", ok: true, status: 200, body: JSON.stringify(payout).slice(0, 300) };
          } catch (err) {
            return { tag: "circle_payout", ok: false, status: 500, body: String(err?.message || err) };
          }
        })(),
      ];

      const results = await Promise.allSettled(tasks);
      console.log("[stripe_webhook] post-processing results", results.map((r) => r.value ?? { status: "rejected" }));
      return res.status(200).json({ received: true });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(200).json({ received: true, warning: err?.message || String(err) });
  }
}
