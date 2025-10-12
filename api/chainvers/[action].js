// pages/api/chainvers/[action].js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

export default async function handler(req, res) {
  try {
    const knownActions = new Set([
      "circle-ping",
      "circle-add-address",
      "circle-payout-test",
      "circle-payout-status",
    ]);

    const rawAction = (() => {
      const query = req.query?.action;
      if (typeof query === "string") return query;
      if (Array.isArray(query)) return query[0];

      const bodyAction = req.body?.action;
      if (typeof bodyAction === "string") return bodyAction;

      const urlPath = (req.url || "").split("?")[0] || "";
      if (urlPath) {
        const segments = urlPath.split("/").filter(Boolean);
        if (segments.length) return segments[segments.length - 1];
      }

      return undefined;
    })();

    const action = rawAction?.toLowerCase();
    if (!action || !knownActions.has(action)) {
      return res.status(404).json({
        error: "Unknown action",
        actions: Array.from(knownActions),
      });
    }

    const id = req.query?.id || req.body?.id;
    const key = process.env.CIRCLE_API_KEY;

    // --- helpers ---
    async function call(endpoint, opts = {}) {
      const url = `${BASE}${endpoint}`;
      const headers = { ...HDRS(key), ...(opts.headers || {}) };
      const body = opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined;
      const r = await fetch(url, { ...opts, headers, body });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { r, json, text };
    }

    function uuid() {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    // ===== Circle: ping =====
    if (action === "circle-ping") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if ((key.match(/:/g) || []).length !== 2) return res.status(400).json({ error: "Malformed CIRCLE_API_KEY" });
      const { r, json, text } = await call("/v1/ping");
      return res.status(r.status).json(json ?? { raw: text });
    }

    // ===== Circle: ADD ADDRESS (FROM_ADDRESS -> Address Book) =====
    if (action === "circle-add-address") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!process.env.FROM_ADDRESS) return res.status(400).json({ error: "Missing FROM_ADDRESS" });

      const body = {
        idempotencyKey: uuid(),
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
        address: process.env.FROM_ADDRESS,
        metadata: { nickname: "Treasury", email: "ops@example.local" },
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: json ?? text });
      return res.status(200).json({ ok: true, addressId: json?.data?.id, status: json?.data?.status, raw: json });
    }

    // ===== Circle: TEST PAYOUT na Address Book recipienta =====
    if (action === "circle-payout-test") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(400).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID" });

      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: json ?? text });
      return res.status(200).json({
        ok: true,
        payoutId: json?.data?.id,
        status: json?.data?.status,
        chain: json?.data?.chain,
        amount: json?.data?.amount,
        destination: json?.data?.destination,
      });
    }

    // ===== Circle: STAV payoutu =====
    if (action === "circle-payout-status") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!id) return res.status(400).json({ error: "Missing ?id=" });
      const { r, json, text } = await call(`/v1/payouts/${id}`);
      return res.status(r.status).json(json ?? { raw: text });
    }

    return res.status(404).json({
      error: "Unknown action",
      actions: Array.from(knownActions),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
