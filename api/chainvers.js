// pages/api/chainvers.js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
const seenPayments = new Set();

export default async function handler(req, res) {
  // 👇 globálny vstupný log
  console.log("[CHAINVERS] START", {
    method: req.method,
    url: req.url,
    action: req.query?.action || null,
    ua: req.headers["user-agent"] || null,
  });

  try {
    const { action, id } = req.query || {};
    const key = process.env.CIRCLE_API_KEY;

    // --- helpers ---
    async function call(endpoint, opts = {}) {
      const url = `${BASE}${endpoint}`;
      const headers = { ...HDRS(key), ...(opts.headers || {}) };
      const body = opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined;
      console.log("[CHAINVERS] CALL", { url, method: opts.method || "GET", hasBody: Boolean(body) });
      const r = await fetch(url, { ...opts, headers, body });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      console.log("[CHAINVERS] RESP", { url, status: r.status, ok: r.ok, preview: text.slice(0, 140) });
      return { r, json, text };
    }
    function uuid() {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random()*16|0, v = c==="x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    async function readJsonBody(req) {
      if (req.body && typeof req.body === "object") return req.body;
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      console.log("[CHAINVERS] RAW BODY", raw.slice(0, 300)); // 👈 uvidíš, čo prišlo
      try { return raw ? JSON.parse(raw) : {}; } catch (e) {
        console.warn("[CHAINVERS] JSON parse fail", e?.message);
        return {};
      }
    }
    const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

    // ===== Circle: ping =====
    if (action === "circle-ping") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if ((key.match(/:/g) || []).length !== 2) return res.status(400).json({ error: "Malformed CIRCLE_API_KEY" });
      const { r, json, text } = await call("/v1/ping");
      console.log("[CHAINVERS] DONE circle-ping");
      return res.status(r.status).json(json ?? { raw: text });
    }

    // ===== Circle: ADD ADDRESS =====
    if (action === "circle-add-address") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!process.env.FROM_ADDRESS) return res.status(400).json({ error: "Missing FROM_ADDRESS" });

      const body = {
        idempotencyKey: uuid(),
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
        address: process.env.FROM_ADDRESS,
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      console.log("[CHAINVERS] DONE circle-add-address", { ok: r.ok, status: r.status, id: json?.data?.id });
      if (!r.ok) return res.status(r.status).json({ ok:false, error: json ?? text });
      return res.status(200).json({ ok:true, addressId: json?.data?.id, status: json?.data?.status, raw: json });
    }

    // ===== Circle: TEST PAYOUT =====
    if (action === "circle-payout-test") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(400).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID" });

      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase()
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
      console.log("[CHAINVERS] DONE circle-payout-test", { ok: r.ok, status: r.status, payoutId: json?.data?.id });
      if (!r.ok) return res.status(r.status).json({ ok:false, error: json ?? text });
      return res.status(200).json({
        ok:true, payoutId: json?.data?.id, status: json?.data?.status,
        chain: json?.data?.chain, amount: json?.data?.amount, destination: json?.data?.destination
      });
    }

    // ===== Circle: STAV payoutu =====
    if (action === "circle-payout-status") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!id) return res.status(400).json({ error: "Missing ?id=" });
      const { r, json, text } = await call(`/v1/payouts/${id}`);
      console.log("[CHAINVERS] DONE circle-payout-status", { ok: r.ok, status: r.status });
      return res.status(r.status).json(json ?? { raw: text });
    }

    // ===== Splitchain =====
    if (action === "splitchain") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const start = Date.now();
      const body = await readJsonBody(req);
      let { paymentIntentId, amount, currency } = body || {};

      console.log("[SPLITCHAIN] IN", { paymentIntentId, amount, currency, bodyPreview: JSON.stringify(body).slice(0, 200) });

      if (!paymentIntentId || typeof amount !== "number" || !currency) {
        console.error("[SPLITCHAIN] BAD PAYLOAD", { paymentIntentId, amount, currency });
        return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
      }
      if (seenPayments.has(paymentIntentId)) {
        console.log("[SPLITCHAIN] DEDUP", { paymentIntentId });
        return res.status(200).json({ ok:true, deduped:true });
      }
      seenPayments.add(paymentIntentId);

      const pPrintify = parseFloat(process.env.SPLIT_PRINTIFY_PERCENT ?? "0.50");
      const pEth      = parseFloat(process.env.SPLIT_ETH_PERCENT ?? "0.30");
      const pProfit   = parseFloat(process.env.SPLIT_PROFIT_PERCENT ?? "0.20");
      const total     = (pPrintify + pEth + pProfit) || 1;

      const split = {
        printify: round2(amount * (pPrintify / total)),
        eth:      round2(amount * (pEth / total)),
        profit:   round2(amount * (pProfit / total)),
      };
      const upperCurrency = String(currency).toUpperCase();

      console.log("[SPLITCHAIN] SPLIT", { perc: {pPrintify, pEth, pProfit}, split, upperCurrency });

      const resp = {
        ok:true,
        paymentIntentId,
        split,
        results: { printify: {status:"reserved", note:`Keep ${split.printify} ${upperCurrency} on card.`}, eth: { skipped: true }, profit: { skipped: true } },
        ms: Date.now() - start,
      };
      console.log("[SPLITCHAIN] OUT", resp);
      return res.status(200).json(resp);
    }

    console.warn("[CHAINVERS] 404", { action });
    return res.status(404).json({ error: "Unknown action", actions: [
      "circle-ping","circle-add-address","circle-payout-test","circle-payout-status","splitchain"
    ]});
  } catch (e) {
    console.error("[CHAINVERS] ERROR", { message: e.message, stack: e.stack });
    return res.status(500).json({ error: e.message || String(e) });
  }
}
