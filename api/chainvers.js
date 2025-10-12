// pages/api/chainvers.js
const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

// idempotencia pre splitchain (in-memory)
const seenPayments = new Set();

export default async function handler(req, res) {
  try {
    const { action, id } = req.query || {};
    const key = process.env.CIRCLE_API_KEY;

    // diagnóza prostredia (pomáha pri chybách)
    const diag = {
      action,
      base: BASE,
      has_key: Boolean(key),
      key_prefix: key ? key.split(":")[0] : null,
      key_colons: key ? (key.match(/:/g) || []).length : 0,
      payout_chain: process.env.PAYOUT_CHAIN || null,
      from_address: process.env.FROM_ADDRESS || null,
      address_book_id: process.env.CIRCLE_ADDRESS_BOOK_ID || null
    };

    // helpers
    async function call(endpoint, opts = {}) {
      const url = `${BASE}${endpoint}`;
      const headers = { ...HDRS(key), ...(opts.headers || {}) };
      const body = opts.body
        ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body))
        : undefined;
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

    // ROUTER
    if (action === "circle-ping") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY", diag });
      if ((key.match(/:/g) || []).length !== 2) {
        return res.status(400).json({ error: "Malformed CIRCLE_API_KEY (must contain exactly two ':' separators)", diag });
      }
      const { r, json, text } = await call("/v1/ping");
      return res.status(r.status).json(json ?? { raw: text, diag });
    }

    if (action === "circle-add-address") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY", diag });
      if (!process.env.FROM_ADDRESS) return res.status(400).json({ error: "Missing FROM_ADDRESS", diag });

      const body = {
        idempotencyKey: uuid(),
        chain: process.env.PAYOUT_CHAIN || "BASE",
        address: process.env.FROM_ADDRESS, // tvoja EOA
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ error: json ?? text, diag });
      return res.status(200).json({ ok: true, addressId: json?.data?.id, status: json?.data?.status, raw: json });
    }

    if (action === "circle-payout-test") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY", diag });
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
        chain: json?.data?.chain,
        amount: json?.data?.amount,
        destination: json?.data?.destination
      });
    }

    if (action === "circle-payout-status") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY", diag });
      if (!id) return res.status(400).json({ error: "Missing ?id=", diag });
      const { r, json, text } = await call(`/v1/payouts/${id}`);
      return res.status(r.status).json(json ?? { raw: text, diag });
    }

    // === SPLITCHAIN (prenesené sem) ===
    if (action === "splitchain") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

      const start = Date.now();
      const body = await readJsonBody(req);
      let { paymentIntentId, amount, currency } = body || {};

      // podpora pre priamy Stripe event
      if (!paymentIntentId && body?.object === "event") {
        const evt = body;
        const okTypes = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
        if (okTypes.has(evt.type)) {
          const session = evt.data?.object;
          if (session?.object === "checkout.session") {
            paymentIntentId = session.payment_intent;
            amount = typeof session.amount_total === "number" ? session.amount_total / 100 : undefined;
            currency = session.currency?.toUpperCase?.();
          }
        }
      }

      if (!paymentIntentId || typeof amount !== "number" || !currency) {
        return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
      }

      if (seenPayments.has(paymentIntentId)) {
        return res.status(200).json({ ok: true, deduped: true });
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

      // 1) Printify reserve (log)
      const printifyResult = { status: "reserved", note: `Keep ${split.printify} ${upperCurrency} on Printify card.` };

      // 2) ETH (voliteľné, interný /api/coinbase_send ak máš)
      let ethResult = { skipped: true };
      if ((process.env.ENABLE_COINBASE_ETH ?? "false").toLowerCase() === "true") {
        const address = process.env.CONTRACT_ADDRESS;
        if (!address) {
          ethResult = { ok: false, error: "Missing CONTRACT_ADDRESS for ETH" };
        } else {
          try {
            const baseURL =
              process.env.BASE_URL ||
              (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
            if (!baseURL) throw new Error("Missing BASE_URL or VERCEL_URL for coinbase_send");

            const r = await fetch(`${baseURL}/api/coinbase_send`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eurAmount: split.eth, to: address, clientRef: paymentIntentId }),
            });
            let json = null, text = await r.text();
            try { json = JSON.parse(text); }
            catch { throw new Error(`coinbase_send returned non-JSON (status ${r.status}): ${text.slice(0,200)}`); }
            ethResult = json;
          } catch (e) {
            ethResult = { ok: false, error: e?.message || String(e) };
          }
        }
      }

      // 3) Stripe Payout (voliteľné)
      let payoutResult = { skipped: true };
      if ((process.env.ENABLE_STRIPE_PAYOUT ?? "false").toLowerCase() === "true") {
        try {
          const { default: Stripe } = await import("stripe");
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const payout = await stripe.payouts.create({
            amount: Math.round(split.profit * 100),
            currency: upperCurrency.toLowerCase(),
          });
          payoutResult = { ok: true, payoutId: payout.id, status: payout.status };
        } catch (e) {
          payoutResult = { ok: false, error: e?.message || String(e) };
        }
      }

      return res.status(200).json({
        ok: true,
        paymentIntentId,
        split,
        results: { printify: printifyResult, eth: ethResult, profit: payoutResult },
        ms: Date.now() - start,
      });
    }

    return res.status(404).json({
      error: "Unknown action",
      actions: ["circle-ping","circle-add-address","circle-payout-test","circle-payout-status","splitchain"],
      diag
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
