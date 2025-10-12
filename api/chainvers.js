// /api/chainvers.js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

export default async function handler(req, res) {
  try {
    const { action } = req.query || {};
    const key = process.env.CIRCLE_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });

    // 1) zdravý ping (overí kľúč/prostredie)
    if (action === "circle-ping") {
      const r = await fetch(`${BASE}/v1/ping`, { headers: HDRS(key) });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    // 2) pridaj recipienta (tvoju FROM_ADDRESS) do Address Book
    if (action === "circle-add-address") {
      if (!process.env.FROM_ADDRESS) return res.status(400).json({ error: "Missing FROM_ADDRESS" });
      const body = {
        idempotencyKey: uuid(),
        chain: process.env.PAYOUT_CHAIN || "BASE",
        address: process.env.FROM_ADDRESS, // ← Tvoja EOA
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const r = await fetch(`${BASE}/v1/addressBook/recipients`, {
        method: "POST", headers: HDRS(key), body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data });
      return res.status(200).json({
        ok: true,
        addressId: data?.data?.id,
        status: data?.data?.status, // pending|active|...
        raw: data
      });
    }

    // 3) testovací payout na Address Book recipienta (USDC/EURC -> tvoja adresa)
    if (action === "circle-payout-test") {
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(400).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID" });
      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: process.env.PAYOUT_CHAIN || "BASE"
      };
      const r = await fetch(`${BASE}/v1/payouts`, {
        method: "POST", headers: HDRS(key), body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data });
      return res.status(200).json({
        ok: true,
        payoutId: data?.data?.id,
        status: data?.data?.status,
        chain: data?.data?.chain,
        amount: data?.data?.amount,
        destination: data?.data?.destination
      });
    }

    // 4) zistenie stavu payoutu podľa ID
    if (action === "circle-payout-status") {
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: "Missing ?id=" });
      const r = await fetch(`${BASE}/v1/payouts/${id}`, { headers: HDRS(key) });
      const data = await r.json();
      return res.status(r.status).json(data);
    }

    // neznáma akcia
    return res.status(404).json({ error: "Unknown action", actions: [
      "circle-ping","circle-add-address","circle-payout-test","circle-payout-status"
    ]});
  } catch (e) {
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
