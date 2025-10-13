// pages/api/circle-add-address.js
// Vytvorí recipienta v Circle Address Book a vráti jeho ID (adr_...)
// ENV, ktoré používa: CIRCLE_API_KEY, CIRCLE_BASE?, PAYOUT_CHAIN?, FROM_ADDRESS

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.CIRCLE_API_KEY;
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const chain = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
    const address = process.env.FROM_ADDRESS;

    // Rýchla validácia ENV
    if (!apiKey) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
    const colonCount = (apiKey.match(/:/g) || []).length;
    if (colonCount !== 2) {
      return res.status(400).json({
        error: "Malformed CIRCLE_API_KEY (musí obsahovať presne dve dvojbodky ':')"
      });
    }
    if (!address) return res.status(400).json({ error: "Missing FROM_ADDRESS" });

    // Idempotency key (aby sa opakované volania nezdvojili)
    const idempotencyKey = uuid();

    const body = {
      idempotencyKey,
      chain,         // napr. "BASE"
      address,       // tvoja EOA adresa (Metamask)
      metadata: {
        nickname: "Treasury",
        email: "ops@example.local"
      }
    };

    const r = await fetch(`${base}/v1/addressBook/recipients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* necháme text v debug výstupe */ }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json || text || "Circle API error",
        hint: "Skontroluj CIRCLE_API_KEY, CIRCLE_BASE, PAYOUT_CHAIN, FROM_ADDRESS"
      });
    }

    const addressId = json?.data?.id;
    const status = json?.data?.status;

    return res.status(200).json({
      ok: true,
      addressId,          // ← toto vlož do ENV ako CIRCLE_ADDRESS_BOOK_ID
      status,             // "active" / "complete" v sandboxe zväčša hneď
      chain: json?.data?.chain,
      addr: json?.data?.address,
      raw: json
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

function uuid() {
  // Vercel/Node 18+: crypto.randomUUID je dostupné
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
