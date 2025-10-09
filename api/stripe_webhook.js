import Stripe from "stripe";

// Stripe potrebuje RAW body kvôli verifikácii podpisu
export const config = { api: { bodyParser: false } };

// jednoduchý (neperzistentný) idempotency guard – pre produkciu použi Redis/DB
const seenEvents = new Set();

export default async function handler(req, res) {
  const startedAt = Date.now();
  console.log("➡️  [WEBHOOK] Incoming", {
    method: req.method,
    sig: !!req.headers["stripe-signature"],
    ua: req.headers["user-agent"],
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
    // načítaj RAW body (bez parsovania)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    console.log("📦  [WEBHOOK] Raw body", { bytes: rawBody.length });

    // verifikuj podpis
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    console.log("✅  [WEBHOOK] Signature OK", {
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      apiVersion: event.api_version,
    });
  } catch (err) {
    console.error("❌  [WEBHOOK] Signature failed", { message: err?.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // idempotency (ak Stripe retryne)
  if (seenEvents.has(event.id)) {
    console.log("♻️  [WEBHOOK] Deduped event", { eventId: event.id });
    return res.status(200).json({ received: true, deduped: true });
  }
  seenEvents.add(event.id);

  try {
    // pokrývame obe situácie (okamžitá aj asynchrónna úspešná platba)
    const handledTypes = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);

    if (handledTypes.has(event.type)) {
      const session = event.data.object;

      // vytiahni hodnoty (Stripe posiela amount v centoch)
      const paymentIntentId = session.payment_intent;
      const amount = (session.amount_total ?? 0) / 100;
      const currency = (session.currency ?? "eur").toUpperCase();

      // metadata – crop_data môže byť string JSON
      let user_address = session.metadata?.user_address || null;
      let crop_data = session.metadata?.crop_data ?? null;
      try {
        if (typeof crop_data === "string") crop_data = JSON.parse(crop_data);
      } catch (e) {
        console.warn("⚠️  [WEBHOOK] crop_data JSON parse failed, keeping raw string");
      }

      console.log("🧾  [WEBHOOK] Session OK", {
        eventType: event.type,
        session_id: session.id,
        paymentIntentId,
        amount,
        currency,
        has_metadata: !!session.metadata,
      });

      // priprav payloady
      const confirmPayload = {
        paymentIntentId,
        crop_data,     // IF si poradí s objektom aj stringom
        user_address,
      };
      const splitPayload = {
        paymentIntentId,
        amount,
        currency,
      };

      console.log("📤  [WEBHOOK] → IF confirm_payment.php", confirmPayload);
      console.log("📤  [WEBHOOK] → Vercel /api/splitchain", splitPayload);

      // spusti obe volania paralelne; nenecháme webhook padnúť
      const confirmUrl = "https://chainvers.free.nf/confirm_payment.php";
      const splitchainUrl =
        process.env.SPLITCHAIN_URL ?? "https://chainvers.vercel.app/api/splitchain";

      const tasks = [
        fetch(confirmUrl, {
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

      // Stripe-ovi odpovedz rýchlo 2xx (inak retry)
      console.log("✅  [WEBHOOK] Done", {
        eventId: event.id,
        ms: Date.now() - startedAt,
      });
      return res.status(200).json({ received: true });
    }

    // voliteľné: log ostatných eventov
    console.log("ℹ️  [WEBHOOK] Unhandled type", { type: event.type, id: event.id });
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("🚨  [WEBHOOK] Handler error", {
      message: err?.message,
      stack: err?.stack,
      eventId: event?.id,
    });
    // daj 200, nech Stripe zbytočne ne-retryuje (ak chceš retry, vráť 500)
    return res.status(200).json({ received: true, warning: "internal error logged" });
  }
}
