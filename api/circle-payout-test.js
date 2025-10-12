export default async function handler(req, res) {
  try {
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const body = {
      idempotencyKey: cryptoRandomUUID(),
      destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
      amount: { amount: "10.00", currency: "USDC" }, // alebo EURC
      chain: process.env.PAYOUT_CHAIN || "BASE"
    };

    const r = await fetch(`${base}/v1/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    res.status(200).json({
      ok: true,
      payoutId: data?.data?.id,
      status: data?.data?.status,
      chain: data?.data?.chain,
      amount: data?.data?.amount,
      destination: data?.data?.destination,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==="x"?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
