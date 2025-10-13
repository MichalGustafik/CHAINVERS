import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { amount, currency, description, crop_data, user_address } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Chýbajú parametre" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: description,
            },
            unit_amount: Math.round(parseFloat(amount) * 100), // eur → centy
          },
          quantity: 1,
        },
      ],
      success_url: `https://chainvers.free.nf/thankyou.php?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://chainvers.free.nf/my_purchases.php`,
      metadata: {
        crop_data: JSON.stringify(crop_data || {}),
        user_address: user_address || "unknown",
      },
    });

    res.status(200).json({ checkout_url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: error.message });
  }
}
