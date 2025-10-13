// pages/api/circle_buy_eth.js
// Automatické kúpenie ETH/USDC cez Circle po Stripe platbe.

const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { eurAmount, to } = req.body || {};
    if (!eurAmount || !to)
      return res.status(400).json({ error: "Missing eurAmount or to" });

    console.log("[CIRCLE] 💳 Buying ETH for", eurAmount, "EUR");

    // 1️⃣ vytvor PaymentIntent (EUR -> USDC cez pripojenú kartu)
    const paymentIntentBody = {
      idempotencyKey: uuid(),
      amount: { amount: String(eurAmount), currency: "EUR" },
      paymentMethod: {
        type: "card",
        id: process.env.CIRCLE_CARD_ID, // ID tvojej pripojenej karty v Circle
      },
      settlementCurrency: "USDC", // prevedie EUR na USDC automaticky
      description: "Auto top-up from CHAINVERS after Stripe payment",
    };

    const createIntent = await fetch(`${CIRCLE_BASE}/v1/paymentIntents`, {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify(paymentIntentBody),
    });
    const intentData = await createIntent.json();
    if (!createIntent.ok) {
      throw new Error(`PaymentIntent failed: ${JSON.stringify(intentData)}`);
    }
    const intentId = intentData?.data?.id;
    console.log("[CIRCLE] ✅ PaymentIntent created", intentId);

    // 2️⃣ počkaj na potvrdenie (zvyčajne instantné)
    await new Promise((r) => setTimeout(r, 5000));

    // 3️⃣ vytvor payout USDC → Base chain adresa
    const payoutBody = {
      idempotencyKey: uuid(),
      destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
      amount: { amount: String(eurAmount), currency: "USDC" },
      chain: process.env.PAYOUT_CHAIN || "BASE",
    };

    const rPayout = await fetch(`${CIRCLE_BASE}/v1/payouts`, {
      method: "POST",
      headers: HDRS,
      body: JSON.stringify(payoutBody),
    });
    const payoutData = await rPayout.json();
    if (!rPayout.ok)
      throw new Error(`Payout failed: ${JSON.stringify(payoutData)}`);

    console.log("[CIRCLE] ✅ Payout created", payoutData?.data?.id);

    return res.status(200).json({
      ok: true,
      paymentIntent: intentId,
      payoutId: payoutData?.data?.id,
      status: payoutData?.data?.status,
    });
  } catch (e) {
    console.error("[CIRCLE] ❌ Error", e?.message);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}