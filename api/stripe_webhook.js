// pages/api/stripe_webhook.js
import Stripe from "stripe";
export const config = { api: { bodyParser: false } };

const seenEvents = new Set();
const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

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
    console.error("[WEBHOOK] ❌ Signature failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (seenEvents.has(event.id)) return res.status(200).json({ received: true, deduped: true });
  seenEvents.add(event.id);

  try {
    const handled = new Set(["checkout.session.completed","checkout.session.async_payment_succeeded"]);
    if (!handled.has(event.type)) return res.status(200).json({ received: true });

    const s = event.data.object;
    const paymentIntentId = s.payment_intent;
    const amount = (s.amount_total ?? 0) / 100;
    const currency = (s.currency ?? "eur").toUpperCase();
    const metadata = s.metadata || {};
    console.log("[WEBHOOK] ✅ Payment", { paymentIntentId, amount, currency });

    const split = { printify: round2(amount * 0.30), revolut: round2(amount * 0.70) };

    const baseURL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    const tasks = [
      // a) potvrdenie PHP
      fetch("https://chainvers.free.nf/confirm_payment.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId, crop_data: metadata?.crop_data ?? null, user_address: metadata?.user_address || null }),
      }).then(async (r) => ({ tag: "confirm_payment", ok: r.ok, status: r.status, body: (await r.text()).slice(0,300) })),

      // b) SplitChain (30/70)
      baseURL ? fetch(`${baseURL}/api/splitchain`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId, amount, currency, split }),
      }).then(async (r) => ({ tag: "splitchain", ok: r.ok, status: r.status, body: (await r.text()).slice(0,300) })) :
        Promise.resolve({ tag:"splitchain", ok:false, status:0, body:"BASE_URL missing" }),

      // c) Circle: EUR z karty → USDC → payout na Base (s pollingom)
      baseURL ? fetch(`${baseURL}/api/circle_buy_eth`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eurAmount: split.revolut }),
      }).then(async (r) => ({ tag: "circle_buy_eth", ok: r.ok, status: r.status, body: (await r.text()).slice(0,500) })) :
        Promise.resolve({ tag:"circle_buy_eth", ok:false, status:0, body:"BASE_URL missing" }),

      // d) log stage
      baseURL ? fetch(`${baseURL}/api/chainpospaidlog`, {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ userId: metadata?.user_id || "anon", sessionId: s.id || paymentIntentId, stage: "STRIPE.WEBHOOK.CONFIRMED", data: { paymentIntentId, amount, currency, split }})
      }) : Promise.resolve({}),
    ];

    const results = await Promise.allSettled(tasks);
    results.forEach((r) => console.log(`[WEBHOOK] ${r.value?.tag || "task"}`, r.value || r.reason));

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[WEBHOOK] ⚠️ Handler error", err?.message);
    return res.status(200).json({ received: true, warning: err?.message });
  }
}