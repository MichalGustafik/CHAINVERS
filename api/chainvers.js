// /api/chainvers.js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";

export default async function handler(req, res) {
  try {
    const { action, id } = req.query || {};
    const key = process.env.CIRCLE_API_KEY;

    // --- diagnóza env ---
    const diag = {
      base: BASE,
      has_key: Boolean(key),
      key_prefix: key ? key.split(":")[0] : null,
      key_colons: key ? (key.match(/:/g) || []).length : 0,
      payout_chain: process.env.PAYOUT_CHAIN || null,
      from_address: process.env.FROM_ADDRESS || null,
      address_book_id: process.env.CIRCLE_ADDRESS_BOOK_ID || null,
      node_version: process.version,
      env_vercel_url: process.env.VERCEL_URL || null,
      action,
    };

    // pomocný fetch wrapper s logovaním
    async function call(endpoint, opts = {}) {
      const url = `${BASE}${endpoint}`;
      const headers = {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(opts.headers || {})
      };
      const body = opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined;

      console.log("▶️  [CIRCLE] CALL", { url, method: opts.method || "GET", has_body: Boolean(body) });
      const r = await fetch(url, { ...opts, headers, body });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }

      console.log("◀️  [CIRCLE] RESP", { status: r.status, ok: r.ok, text_preview: text.slice(0, 600) });
      return { r, json, text };
    }

    // základná validácia
    if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY", diag });
    if ((key.match(/:/g) || []).length !== 2) {
      return res.status(400).json({ error: "Malformed CIRCLE_API_KEY (must contain exactly two ':' separators)", diag });
    }

    // router
    if (action === "circle-ping") {
      const { r, json, text } = await call("/v1/ping");
      return res.status(r.status).json(json ?? { raw: text, diag });
    }

    if (action === "circle-add-address") {
      if (!process.env.FROM_ADDRESS) return res.status(400).json({ error: "Missing FROM_ADDRESS", diag });
      const body = {
        idempotencyKey: uuid(),
        chain: process.env.PAYOUT_CHAIN || "BASE",
        address: process.env.FROM_ADDRESS,
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ error: json ?? text, diag });
      return res.status(200).json({ ok: true, addressId: json?.data?.id, status: json?.data?.status, raw: json, diag });
    }

    if (action === "circle-payout-test") {
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(400).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID", diag });
      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: process.env.PAYOUT_CHAIN || "BASE"
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ error: json ?? text, diag });
      return res.status(200).json({
        ok: true,
        payoutId: json?.data?.id,
        status: json?.data?.status,
        amount: json?.data?.amount,
        chain: json?.data?.chain,
        destination: json?.data?.destination,
        diag
      });
    }

    if (action === "circle-payout-status") {
      if (!id) return res.status(400).json({ error: "Missing ?id=", diag });
      const { r, json, text } = await call(`/v1/payouts/${id}`);
      return res.status(r.status).json(json ?? { raw: text, diag });
    }

    return res.status(404).json({ error: "Unknown action", actions: [
      "circle-ping","circle-add-address","circle-payout-test","circle-payout-status"
    ], diag });
  } catch (e) {
    console.error("💥  [CHAINVERS] ERROR", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==="x"? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
