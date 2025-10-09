import Stripe from "stripe";

// Stripe potrebuje RAW body kvôli verifikácii podpisu
export const config = { api: { bodyParser: false } };

// jednoduchý (in-memory) idempotency guard – do produkcie zvaž Redis/KV/DB
const seenEvents = new Set();

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
        process.env.SPLITCHAIN_URL
          || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/splitchain` : "https://chainvers.vercel.app/api/splitchain");

      // payloady
      const confirmPayload = { paymentIntentId, crop_data, user_address };
      const splitPayload   = { paymentIntentId, amount, currency };

      console.log("📤  [WEBHOOK] → IF confirm_payment.php", confirmPayload);
      console.log("📤  [WEBHOOK] → Vercel /api/splitchain", { url: splitchainUrl, ...splitPayload });

      // spusti paralelne (a návrat Stripe-u rýchlo 2xx)
      const tasks = [
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
      ];

      const results = await Promise.allSettled(tasks);
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
    // nech Stripe zbytočne ne-retryuje (alebo vráť 500 ak retry chceš)
    return res.status(200).json({ received: true, warning: "internal error logged" });
  }
}
