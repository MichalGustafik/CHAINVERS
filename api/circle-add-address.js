export default async function handler(req, res) {
  try {
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const body = {
      idempotencyKey: uuid(),
      chain: process.env.PAYOUT_CHAIN || "BASE",
      address: process.env.FROM_ADDRESS,        // ← TVOJA premenná
      metadata: { nickname: "Treasury", email: "ops@example.local" }
    };

    const r = await fetch(`${base}/v1/addressBook/recipients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    const addressId = data?.data?.id;
    const status = data?.data?.status; // pending|active|...
    res.status(200).json({ ok: true, addressId, status, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==="x"? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
