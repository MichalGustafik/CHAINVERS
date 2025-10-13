import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { amount, currency, description, crop_data } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    // Inicializácia Stripe pomocou secret key z Vercel ENV
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Vytvoríme PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(parseFloat(amount) * 100), // eur -> centy
      currency,
      description,
      metadata: {
        crop_data: JSON.stringify(crop_data || {}),
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ error: error.message });
  }
}
