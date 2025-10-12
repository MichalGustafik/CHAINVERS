export default async function handler(req, res) {
  try {
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const body = {
      idempotencyKey: cryptoRandomUUID(),
      chain: process.env.PAYOUT_CHAIN || "BASE",     // BASE = Base network
      address: process.env.TREASURY_ADDRESS,         // tvoja EOA adresa
      metadata: {
        nickname: "Chainvers Treasury",
        email: "ops@chainvers.local"
      }
    };

    const r = await fetch(`${base}/v1/addressBook/recipients`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CIRCLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    const addressId = data?.data?.id;
    const status = data?.data?.status;
    return res.status(200).json({ ok: true, addressId, status, raw: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
