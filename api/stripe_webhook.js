import Stripe from "stripe";

// Stripe musí mať raw body (kvôli podpisu)
export const config = { api: { bodyParser: false } };

const seenEvents = new Set();

// ======================
// CIRCLE CONFIG
// ======================
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const CIRCLE_HEADERS = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

// helper pre idempotencyKey
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Circle payout funkcia
async function circlePayout({ amount, currency = "USDC" }) {
  const body = {
    idempotencyKey: uuid(),
    destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
    amount: { amount: String(amount), currency },
    chain: process.env.PAYOUT_CHAIN || "BASE",
  };
  const r = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
    method: "POST",
    headers: CIRCLE_HEADERS,
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Circle payout failed: ${r.status} ${JSON.stringify(data)}`);
  return data?.data;
}

// pomocná funkcia
const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// ======================
// Hlavný handler
// ======================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
    console.error("[WEBHOOK] Signature failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (seenEvents.has(event.id)) {
    console.log("[WEBHOOK] Deduped", event.id);
    return res.status(200).json({ received: true, deduped: true });
  }
  seenEvents.add(event.id);

  try {
    const handled = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);

    if (!handled.has(event.type)) {
      console.log("[WEBHOOK] Unhandled type:", event.type);
      return res.status(200).json({ received: true });
    }

    // --------------------------
    // 1️⃣  Načítaj údaje zo Stripe session
    // --------------------------
    const session = event.data.object;
    const paymentIntentId = session.payment_intent;
    const amount = (session.amount_total ?? 0) / 100;
    const currency = (session.currency ?? "eur").toUpperCase();
    const metadata = session.metadata || {};

    console.log("[WEBHOOK] ✅ Payment OK", {
      paymentIntentId, amount, currency, metadata
    });

    // --------------------------
    // 2️⃣  Potvrdenie nákupu (PHP)
    // --------------------------
    const confirmPayload = {
      paymentIntentId,
      crop_data: metadata?.crop_data ?? null,
      user_address: metadata?.user_address || null,
    };

    // --------------------------
    // 3️⃣  SplitChain rozdelenie 30/30/30/10
    // --------------------------
    const split = {
      printify: round2(amount * 0.3),
      crypto: round2(amount * 0.3),
      profit: round2(amount * 0.3),
      fees: round2(amount * 0.1),
    };

    console.log("[SPLITCHAIN] 💰 Rozdelenie", split);

    // --------------------------
    // 4️⃣  Volania paralelne (3 úlohy)
    // --------------------------
    const splitchainUrl =
      process.env.SPLITCHAIN_URL
        || (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}/api/splitchain`
              : "https://chainvers.vercel.app/api/splitchain");

    const useToken = process.env.CIRCLE_PAYOUT_CURRENCY || "USDC";
    const amountToToken = split.crypto; // crypto časť 30%

    const tasks = [
      // (1) PHP potvrdenie
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

      // (2) volanie interného SplitChainu – ak máš endpoint na ďalšie spracovanie
      fetch(splitchainUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId,
          amount,
          currency,
          split,
        }),
      }).then(async (r) => ({
        tag: "splitchain",
        ok: r.ok,
        status: r.status,
        body: (await r.text()).slice(0, 300),
      })),

      // (3) Circle payout (crypto 30%)
      (async () => {
        try {
          const payout = await circlePayout({
            amount: amountToToken,
            currency: useToken,
          });
          return {
            tag: "circle_payout",
            ok: true,
            status: 200,
            body: JSON.stringify(payout).slice(0, 300),
          };
        } catch (e) {
          return {
            tag: "circle_payout",
            ok: false,
            status: 500,
            body: String(e?.message || e),
          };
        }
      })(),
    ];

    const results = await Promise.allSettled(tasks);

    results.forEach((r) => {
      if (r.status === "fulfilled") {
        console.log(`[WEBHOOK] ${r.value.tag} →`, {
          ok: r.value.ok,
          status: r.value.status,
          body_preview: r.value.body,
        });
      } else {
        console.error("[WEBHOOK] Task failed:", r.reason);
      }
    });

    // --------------------------
    // 5️⃣  Hotovo
    // --------------------------
    console.log("[WEBHOOK] ✅ Done", { paymentIntentId });
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("[WEBHOOK] Handler error:", err?.message);
    return res.status(200).json({ received: true, warning: err?.message || String(err) });
  }
}