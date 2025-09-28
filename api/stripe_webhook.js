import Stripe from "stripe";

// Stripe očakáva raw body, nie JSON (dôležité pre validáciu podpisu)
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // nastavíš vo Verceli

  let event;

  try {
    // načítanie raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // overenie podpisu webhooku
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // spracovanie eventov
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log("✅ Payment succeeded:", paymentIntent.id);
        // tu si môžeš uložiť objednávku do DB alebo volať InfinityFree API
        break;

      case "payment_intent.payment_failed":
        const failedIntent = event.data.object;
        console.log("❌ Payment failed:", failedIntent.last_payment_error?.message);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).send("Webhook handler failed");
  }
}
