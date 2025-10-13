// pages/api/chainvers.js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
const seenPayments = new Set(); // idempotencia pre splitchain

export default async function handler(req, res) {
  const started = Date.now();
  const SENSITIVE = new Set(["authorization", "cookie", "x-forwarded-for", "x-real-ip"]);
  const maskHeaders = (headers = {}) => Object.fromEntries(
    Object.entries(headers).map(([name, value]) => (
      SENSITIVE.has(String(name).toLowerCase()) ? [name, "[redacted]"] : [name, value]
    ))
  );

  let baseLog = null;
  let requestBody;
  const logResponse = (status, payload) => {
    const details = baseLog ?? {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      action: req.query?.action,
      query: req.query,
      headers: maskHeaders(req.headers),
      body: requestBody,
    };
    console.log("[api/splitchain]", JSON.stringify({
      ...details,
      status,
      durationMs: Date.now() - started,
      response: payload,
    }, null, 2));
  };

  try {
    const { id } = req.query || {};
    const action = req.query?.action || (req.method === "POST" ? "splitchain" : undefined);
    const key = process.env.CIRCLE_API_KEY;

    // --- helpers ---
    async function call(endpoint, opts = {}) {
      const url = `${BASE}${endpoint}`;
      const headers = { ...HDRS(key), ...(opts.headers || {}) };
      const body = opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined;
      const r = await fetch(url, { ...opts, headers, body });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { r, json, text };
    }
    function uuid() {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random()*16|0, v = c==="x"? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    async function readJsonBody(req) {
      if (req.body && typeof req.body === "object") return req.body;
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
    }
    const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

    requestBody = await readJsonBody(req);

    baseLog = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.url,
      action,
      query: req.query,
      headers: maskHeaders(req.headers),
      body: requestBody,
    };

    // ===== Circle: ping =====
    if (action === "circle-ping") {
      if (!key) {
        const payload = { error: "Missing CIRCLE_API_KEY" };
        logResponse(500, payload);
        return res.status(500).json(payload);
      }
      if ((key.match(/:/g) || []).length !== 2) {
        const payload = { error: "Malformed CIRCLE_API_KEY" };
        logResponse(400, payload);
        return res.status(400).json(payload);
      }
      const { r, json, text } = await call("/v1/ping");
      const payload = json ?? { raw: text };
      logResponse(r.status, payload);
      return res.status(r.status).json(payload);
    }

    // ===== Circle: ADD ADDRESS (FROM_ADDRESS -> Address Book) =====
    if (action === "circle-add-address") {
      if (!key) {
        const payload = { error: "Missing CIRCLE_API_KEY" };
        logResponse(500, payload);
        return res.status(500).json(payload);
      }
      if (!process.env.FROM_ADDRESS) {
        const payload = { error: "Missing FROM_ADDRESS" };
        logResponse(400, payload);
        return res.status(400).json(payload);
      }

      const body = {
        idempotencyKey: uuid(),
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
        address: process.env.FROM_ADDRESS,
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      if (!r.ok) {
        const payload = { ok:false, error: json ?? text };
        logResponse(r.status, payload);
        return res.status(r.status).json(payload);
      }
      const payload = { ok:true, addressId: json?.data?.id, status: json?.data?.status, raw: json };
      logResponse(200, payload);
      return res.status(200).json(payload);
    }

    // ===== Circle: TEST PAYOUT na Address Book recipienta =====
    if (action === "circle-payout-test") {
      if (!key) {
        const payload = { error: "Missing CIRCLE_API_KEY" };
        logResponse(500, payload);
        return res.status(500).json(payload);
      }
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) {
        const payload = { error: "Missing CIRCLE_ADDRESS_BOOK_ID" };
        logResponse(400, payload);
        return res.status(400).json(payload);
      }

      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase()
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
      if (!r.ok) {
        const payload = { ok:false, error: json ?? text };
        logResponse(r.status, payload);
        return res.status(r.status).json(payload);
      }
      const payload = {
        ok:true, payoutId: json?.data?.id, status: json?.data?.status,
        chain: json?.data?.chain, amount: json?.data?.amount, destination: json?.data?.destination
      };
      logResponse(200, payload);
      return res.status(200).json(payload);
    }

    // ===== Circle: STAV payoutu =====
    if (action === "circle-payout-status") {
      if (!key) {
        const payload = { error: "Missing CIRCLE_API_KEY" };
        logResponse(500, payload);
        return res.status(500).json(payload);
      }
      if (!id) {
        const payload = { error: "Missing ?id=" };
        logResponse(400, payload);
        return res.status(400).json(payload);
      }
      const { r, json, text } = await call(`/v1/payouts/${id}`);
      const payload = json ?? { raw: text };
      logResponse(r.status, payload);
      return res.status(r.status).json(payload);
    }

    // ===== Splitchain (presunutý sem) =====
    if (action === "splitchain") {
      if (req.method !== "POST") {
        const payload = { error: "Method not allowed" };
        logResponse(405, payload);
        return res.status(405).json(payload);
      }
      const start = Date.now();
      let { paymentIntentId, amount, currency } = requestBody || {};

      if (!paymentIntentId || typeof amount !== "number" || !currency) {
        const payload = { error: "Missing paymentIntentId, amount or currency" };
        logResponse(400, payload);
        return res.status(400).json(payload);
      }
      if (seenPayments.has(paymentIntentId)) {
        const payload = { ok:true, deduped:true };
        logResponse(200, payload);
        return res.status(200).json(payload);
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

      let ethResult = { skipped: true }; // ak chceš /api/coinbase_send, pridaj si ho neskôr
      let payoutResult = { skipped: true }; // Stripe Payouts voliteľne

      const payload = {
        ok:true,
        paymentIntentId,
        split,
        results: { printify: {status:"reserved", note:`Keep ${split.printify} ${upperCurrency} on card.`}, eth: ethResult, profit: payoutResult },
        ms: Date.now() - start,
      };
      logResponse(200, payload);
      return res.status(200).json(payload);
    }

    const payload = { error: "Unknown action", actions: [
      "circle-ping","circle-add-address","circle-payout-test","circle-payout-status","splitchain"
    ] };
    logResponse(404, payload);
    return res.status(404).json(payload);
  } catch (e) {
    const payload = { error: e.message || String(e) };
    console.error("[api/splitchain] error", e);
    logResponse(500, payload);
    return res.status(500).json(payload);
  }
}
