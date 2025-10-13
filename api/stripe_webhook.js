// pages/api/stripe_webhook.js
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

const seenEvents = new Set();
const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const rawBody = Buffer.concat(chunks);
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("[WEBHOOK] ❌ Signature failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (seenEvents.has(event.id))
    return res.status(200).json({ received: true, deduped: true });
  seenEvents.add(event.id);

  try {
    const handled = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);
    if (!handled.has(event.type))
      return res.status(200).json({ received: true });

    const s = event.data.object;
    const paymentIntentId = s.payment_intent;
    const amount = (s.amount_total ?? 0) / 100;
    const currency = (s.currency ?? "eur").toUpperCase();
    const metadata = s.metadata || {};

    console.log("[WEBHOOK] ✅ Payment success", {
      paymentIntentId,
      amount,
      currency,
    });

    const baseURL =
      process.env.BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    // zapíš log (štart spracovania)
    await logStage(baseURL, "STRIPE.PAYMENT.SUCCESS", {
      paymentIntentId,
      amount,
      currency,
    });

    // priprav Circle payout payload
    const payoutAmount = round2(amount);
    const payoutBody = {
      amount: String(payoutAmount),
      currency: "USDC",
      to: process.env.CONTRACT_ADDRESS,
    };

    // vykonaj payout cez náš endpoint
    const payoutRes = await fetch(`${baseURL}/api/circle_payout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payoutBody),
    });
    const payoutTxt = await payoutRes.text();
    let payoutJson = null;
    try {
      payoutJson = JSON.parse(payoutTxt);
    } catch {
      payoutJson = { raw: payoutTxt };
    }

    // logni výsledok payoutu
    await logStage(baseURL, "CIRCLE.PAYOUT.RESULT", {
      ok: payoutRes.ok,
      status: payoutRes.status,
      payout: payoutJson,
    });

    // finálny log
    await logStage(baseURL, "PROCESS.COMPLETE", {
      paymentIntentId,
      payout: payoutJson?.payoutId,
    });

    return res.status(200).json({
      ok: true,
      paymentIntentId,
      payoutResult: payoutJson,
    });
  } catch (err) {
    console.error("[WEBHOOK] ⚠️ Error", err);
    await logStage(process.env.BASE_URL, "PROCESS.ERROR", {
      error: err?.message || String(err),
    });
    return res.status(200).json({ ok: false, error: err?.message });
  }
}

// 🔹 pomocná funkcia pre logovanie do /api/chainpospaidlog
async function logStage(baseURL, stage, data) {
  try {
    if (!baseURL) return;
    await fetch(`${baseURL}/api/chainpospaidlog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "anon",
        sessionId: data?.paymentIntentId || "",
        stage,
        data,
      }),
    });
  } catch (e) {
    console.error("[LOG] Failed:", e.message);
  }
}