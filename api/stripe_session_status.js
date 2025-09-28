import Stripe from "stripe";

export default async function handler(req, res) {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    res.status(200).json({
      id: session.id,
      payment_status: session.payment_status,
      payment_intent: session.payment_intent,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ error: error.message });
  }
}
