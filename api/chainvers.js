// pages/api/chainvers.js
export const config = { api: { bodyParser: false } };

const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const HDRS = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
const seenPayments = new Set(); // idempotencia pre splitchain
const seenStripeEvents = new Set();
const BODY_CACHE = Symbol.for("CHAINVERS_BODY_CACHE");

export default async function handler(req, res) {
  try {
    const { action, id } = req.query || {};
    const key = process.env.CIRCLE_API_KEY;

    // --- helpers ---
    async function getStripe() {
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
      if (!globalThis.__stripeInstance) {
        const { default: Stripe } = await import("stripe");
        globalThis.__stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: process.env.STRIPE_API_VERSION || "2022-11-15",
        });
      }
      return globalThis.__stripeInstance;
    }
    async function getEthersWallet() {
      const providerUrl = process.env.PROVIDER_URL;
      const privKey = process.env.PRIVATE_KEY;
      const contractAddress = process.env.CONTRACT_ADDRESS || process.env.FROM_ADDRESS;
      if (!providerUrl || !privKey || !contractAddress) {
        throw new Error("Missing PROVIDER_URL/PRIVATE_KEY/CONTRACT_ADDRESS for Base chain interaction");
      }
      if (!globalThis.__ethersWallet) {
        const { ethers } = await import("ethers");
        const provider = new ethers.providers.JsonRpcProvider(providerUrl);
        const wallet = new ethers.Wallet(privKey, provider);
        globalThis.__ethersWallet = { ethers, wallet };
      }
      return { ...globalThis.__ethersWallet, contractAddress };
    }
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
    async function readBody(req) {
      if (req[BODY_CACHE]) return req[BODY_CACHE];
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        const cached = { buffer: Buffer.from(JSON.stringify(req.body)), text: JSON.stringify(req.body), json: req.body };
        req[BODY_CACHE] = cached;
        return cached;
      }
      const chunks = [];
      for await (const ch of req) {
        chunks.push(typeof ch === "string" ? Buffer.from(ch) : Buffer.from(ch));
      }
      const buffer = Buffer.concat(chunks);
      const text = buffer.toString("utf8");
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch {}
      const cached = { buffer, text, json };
      req[BODY_CACHE] = cached;
      return cached;
    }
    const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
    const payoutCurrency = (process.env.CIRCLE_PAYOUT_CURRENCY || "USDC").toUpperCase();
    const payoutChain = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();

    function computeSplit(amount) {
      const pPrintify = parseFloat(process.env.SPLIT_PRINTIFY_PERCENT ?? "0.50");
      const pEth      = parseFloat(process.env.SPLIT_ETH_PERCENT ?? "0.30");
      const pProfit   = parseFloat(process.env.SPLIT_PROFIT_PERCENT ?? "0.20");
      const total     = (pPrintify + pEth + pProfit) || 1;
      return {
        printify: round2(amount * (pPrintify / total)),
        eth:      round2(amount * (pEth / total)),
        profit:   round2(amount * (pProfit / total)),
      };
    }
    function convertToPayoutCurrency(amount) {
      const rate = parseFloat(process.env.SPLIT_PAYOUT_RATE || "1");
      if (!isFinite(rate) || rate <= 0) return round2(amount);
      return round2(amount * rate);
    }
    function convertToEthAmount(amount) {
      const divider = parseFloat(process.env.SPLIT_ETH_PRICE || "0");
      if (!divider || !isFinite(divider) || divider <= 0) return amount;
      const eth = amount / divider;
      return Number.isFinite(eth) ? Number(eth.toFixed(6)) : amount;
    }
    async function ensureCircleBalance(requiredAmount) {
      if (!key) return { skipped: true, reason: "Missing CIRCLE_API_KEY" };
      if (!process.env.CIRCLE_BALANCE_CHECK) return { skipped: true, reason: "CIRCLE_BALANCE_CHECK disabled" };
      const { json } = await call("/v1/businessAccount/balances");
      const balances = json?.data || [];
      const target = balances.find((b) => (b?.currency || "").toUpperCase() === payoutCurrency);
      const available = parseFloat(target?.available ?? target?.amount ?? "0");
      if (available >= requiredAmount) {
        return { ok: true, ensured: true, available: round2(available) };
      }
      if (!process.env.CIRCLE_TOPUP_SOURCE_WALLET_ID || !process.env.CIRCLE_TOPUP_DESTINATION_WALLET_ID) {
        return { ok: false, ensured: false, available: round2(available), required: requiredAmount, reason: "Insufficient balance and topup disabled" };
      }
      const topupAmount = round2(Math.max(requiredAmount - available, parseFloat(process.env.CIRCLE_TOPUP_AMOUNT || "0")));
      const body = {
        idempotencyKey: uuid(),
        source: { type: "wallet", id: process.env.CIRCLE_TOPUP_SOURCE_WALLET_ID },
        destination: { type: "wallet", id: process.env.CIRCLE_TOPUP_DESTINATION_WALLET_ID },
        amount: { amount: String(topupAmount), currency: payoutCurrency },
      };
      const { r, json: topupJson, text } = await call("/v1/businessAccount/transfers", { method: "POST", body });
      return {
        ok: r.ok,
        ensured: r.ok,
        available: round2(available),
        required: requiredAmount,
        topupAmount,
        transferId: topupJson?.data?.id,
        response: topupJson ?? { raw: text },
      };
    }
    async function triggerCirclePayout({ amount, description, metadata }) {
      if (!key) throw new Error("Missing CIRCLE_API_KEY");
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID && !process.env.CIRCLE_PAYOUT_ADDRESS) {
        throw new Error("Missing CIRCLE_ADDRESS_BOOK_ID or CIRCLE_PAYOUT_ADDRESS");
      }
      const destination = process.env.CIRCLE_ADDRESS_BOOK_ID
        ? { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID }
        : { type: "blockchain", address: process.env.CIRCLE_PAYOUT_ADDRESS, chain: payoutChain };
      const body = {
        idempotencyKey: uuid(),
        destination,
        amount: { amount: String(amount), currency: payoutCurrency },
        chain: payoutChain,
        metadata: metadata || undefined,
        description: description || undefined,
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
      if (!r.ok) throw new Error(`Circle payout failed: ${r.status} ${(json && JSON.stringify(json)) || text}`);
      return json?.data ?? json ?? { raw: text };
    }
    async function triggerPrintifyReservation({ paymentIntentId, amount, currency, metadata }) {
      if (!process.env.PRINTIFY_WEBHOOK_URL) {
        return { skipped: true, reason: "Missing PRINTIFY_WEBHOOK_URL" };
      }
      const payload = {
        idempotencyKey: uuid(),
        paymentIntentId,
        amount,
        currency,
        metadata,
      };
      const headers = { "Content-Type": "application/json" };
      if (process.env.PRINTIFY_API_KEY) headers.Authorization = `Bearer ${process.env.PRINTIFY_API_KEY}`;
      const r = await fetch(process.env.PRINTIFY_WEBHOOK_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      return {
        ok: r.ok,
        status: r.status,
        body: text.slice(0, 500),
      };
    }
    async function triggerContractTransfer({ amount, paymentIntentId, metadata }) {
      if (!amount) return { skipped: true, reason: "Zero amount" };
      const { ethers, wallet, contractAddress } = await getEthersWallet();
      const value = ethers.utils.parseEther(String(amount));
      const tx = await wallet.sendTransaction({ to: contractAddress, value, data: metadata?.contractData || "0x" });
      const receipt = await tx.wait(1);
      return { ok: true, txHash: receipt.transactionHash };
    }
    async function orchestrateSplitFlow({ paymentIntentId, amount, currency, metadata }) {
      const split = computeSplit(amount);
      const printify = await triggerPrintifyReservation({ paymentIntentId, amount: split.printify, currency, metadata });
      const payoutAmount = convertToPayoutCurrency(split.eth + split.profit);
      let circleBalance = { skipped: true };
      let circlePayout = { skipped: true };
      if (payoutAmount > 0) {
        circleBalance = await ensureCircleBalance(payoutAmount);
        try {
          circlePayout = await triggerCirclePayout({ amount: payoutAmount, description: `CHAINVERS split for ${paymentIntentId}`, metadata: { paymentIntentId, currency } });
        } catch (e) {
          circlePayout = { ok: false, error: e.message };
        }
      }
      let contract = { skipped: true };
      const ethAmount = convertToEthAmount(split.eth);
      if (ethAmount > 0) {
        try {
          contract = await triggerContractTransfer({ amount: ethAmount, paymentIntentId, metadata });
        } catch (e) {
          contract = { ok: false, error: e.message };
        }
      }
      return { split, results: { printify, circleBalance, circlePayout, contract }, currency };
    }

    // ===== Circle: ping =====
    if (action === "circle-ping") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if ((key.match(/:/g) || []).length !== 2) return res.status(400).json({ error: "Malformed CIRCLE_API_KEY" });
      const { r, json, text } = await call("/v1/ping");
      return res.status(r.status).json(json ?? { raw: text });
    }

    // ===== Circle: balances =====
    if (action === "circle-balances") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      const { r, json, text } = await call("/v1/businessAccount/balances");
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
        metadata: { nickname: "Treasury", email: "ops@example.local" }
      };
      const { r, json, text } = await call("/v1/addressBook/recipients", { method: "POST", body });
      if (!r.ok) return res.status(r.status).json({ ok:false, error: json ?? text });
      return res.status(200).json({ ok:true, addressId: json?.data?.id, status: json?.data?.status, raw: json });
    }

    // ===== Circle: TEST PAYOUT na Address Book recipienta =====
    if (action === "circle-payout-test") {
      if (!key) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
      if (!process.env.CIRCLE_ADDRESS_BOOK_ID) return res.status(400).json({ error: "Missing CIRCLE_ADDRESS_BOOK_ID" });

      const body = {
        idempotencyKey: uuid(),
        destination: { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID },
        amount: { amount: "10.00", currency: process.env.CIRCLE_PAYOUT_CURRENCY || "USDC" },
        chain: payoutChain
      };
      const { r, json, text } = await call("/v1/payouts", { method: "POST", body });
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
      return res.status(r.status).json(json ?? { raw: text });
    }

    // ===== Stripe: create Payment Intent =====
    if (action === "stripe-payment-intent") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { json: body } = await readBody(req);
      const { amount, currency, description, crop_data } = body || {};
      if (!amount || !currency) return res.status(400).json({ error: "Missing amount/currency" });
      const stripe = await getStripe();
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(parseFloat(amount) * 100),
        currency,
        description,
        metadata: { crop_data: JSON.stringify(crop_data || {}), router: "chainvers" },
      });
      return res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        paymentIntentId: paymentIntent.id,
      });
    }

    // ===== Stripe: create Checkout Session =====
    if (action === "stripe-checkout-session") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { json: body } = await readBody(req);
      const { amount, currency, description, crop_data, user_address } = body || {};
      if (!amount || !currency) return res.status(400).json({ error: "Missing amount/currency" });
      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency,
              product_data: { name: description },
              unit_amount: Math.round(parseFloat(amount) * 100),
            },
            quantity: 1,
          },
        ],
        success_url: process.env.STRIPE_SUCCESS_URL || "https://chainvers.free.nf/thankyou.php?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: process.env.STRIPE_CANCEL_URL || "https://chainvers.free.nf/my_purchases.php",
        metadata: {
          crop_data: JSON.stringify(crop_data || {}),
          user_address: user_address || "unknown",
          router: "chainvers",
        },
      });
      return res.status(200).json({ checkout_url: session.url });
    }

    // ===== Stripe: session status =====
    if (action === "stripe-session-status") {
      const session_id = req.query?.session_id;
      if (!session_id) return res.status(400).json({ error: "Missing session_id" });
      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id);
      return res.status(200).json({
        id: session.id,
        payment_status: session.payment_status,
        payment_intent: session.payment_intent,
        metadata: session.metadata,
      });
    }

    // ===== Stripe: webhook =====
    if (action === "stripe-webhook") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const stripe = await getStripe();
      const signature = req.headers["stripe-signature"];
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!signature || !endpointSecret) return res.status(400).json({ error: "Missing Stripe signature or webhook secret" });
      const { buffer } = await readBody(req);
      let event;
      try {
        event = stripe.webhooks.constructEvent(buffer, signature, endpointSecret);
      } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
      if (seenStripeEvents.has(event.id)) return res.status(200).json({ received: true, deduped: true });
      seenStripeEvents.add(event.id);
      const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
      if (handled.has(event.type)) {
        const session = event.data.object;
        const paymentIntentId = session.payment_intent;
        const amount = (session.amount_total ?? 0) / 100;
        const currency = (session.currency ?? "eur").toUpperCase();
        let cropData = null;
        if (session.metadata?.crop_data) {
          try { cropData = JSON.parse(session.metadata.crop_data); } catch { cropData = session.metadata.crop_data; }
        }
        const metadata = {
          crop_data: cropData,
          user_address: session.metadata?.user_address || null,
        };
        const flow = await orchestrateSplitFlow({ paymentIntentId, amount, currency, metadata });
        return res.status(200).json({ received: true, flow });
      }
      return res.status(200).json({ received: true });
    }

    // ===== Splitchain (presunutý sem) =====
    if (action === "splitchain") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const start = Date.now();
      const { json: body } = await readBody(req);
      let { paymentIntentId, amount, currency } = body || {};

      if (!paymentIntentId || typeof amount !== "number" || !currency) {
        return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
      }
      if (seenPayments.has(paymentIntentId)) return res.status(200).json({ ok:true, deduped:true });
      seenPayments.add(paymentIntentId);
      const upperCurrency = String(currency).toUpperCase();
      const flow = await orchestrateSplitFlow({ paymentIntentId, amount, currency: upperCurrency, metadata: body?.metadata || {} });
      return res.status(200).json({ ok: true, paymentIntentId, ...flow, ms: Date.now() - start });
    }

    return res.status(404).json({ error: "Unknown action", actions: [
      "circle-ping","circle-balances","circle-add-address","circle-payout-test","circle-payout-status",
      "stripe-payment-intent","stripe-checkout-session","stripe-session-status","stripe-webhook","splitchain"
    ]});
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
