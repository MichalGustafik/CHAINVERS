export default async function handler(req, res) {
  try {
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const body = {
      idempotencyKey: cryptoRandomUUID(),     // UUID v4
      address: process.env.TREASURY_ADDRESS,  // Tvoja EOA
      chain: process.env.PAYOUT_CHAIN || "BASE",
      metadata: {
        nickname: "Chainvers Treasury",
        email: "ops@chainvers.local"          // hocijaký tvoj servisný email
        // bns: "chainvers.eth"               // voliteľné
      }
      // addressTag: ""                       // len pre siete s memo/tag (XRP, XLM…)
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
    if (!r.ok) {
      return res.status(r.status).json({ error: data });
    }

    const addressId = data?.data?.id; // toto ulož do ENV: CIRCLE_ADDRESS_BOOK_ID
    return res.status(200).json({ ok: true, addressId, raw: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// malý helper (bez importov)
function cryptoRandomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}