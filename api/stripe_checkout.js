// pages/api/stripe_checkout.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const {
      line_items,
      amount, // v centoch
      currency = "eur",
      success_url = `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url  = `${req.headers.origin}/cancel`,
      metadata = {},
      mode = "payment",
    } = req.body || {};

    let session;
    if (Array.isArray(line_items) && line_items.length) {
      session = await stripe.checkout.sessions.create({ mode, line_items, success_url, cancel_url, metadata });
    } else if (typeof amount === "number") {
      session = await stripe.checkout.sessions.create({
        mode,
        line_items: [{
          price_data: { currency, product_data: { name: "Order" }, unit_amount: amount },
          quantity: 1,
        }],
        success_url, cancel_url, metadata,
      });
    } else {
      return res.status(400).json({ error: "Provide line_items[] or amount (in cents)" });
    }

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    console.error("[CHECKOUT] ERROR", e);
    return res.status(500).json({ error: e.message || "Stripe checkout failed" });
  }
}