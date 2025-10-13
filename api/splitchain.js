// pages/api/splitchain.js
// Spracuje a rozdelí platbu po Stripe checkoute.
// Automaticky volaný zo stripe_webhook.js.

import Stripe from "stripe";

const seenPayments = new Set();

export default async function handler(req, res) {
  console.log("[SPLITCHAIN] START", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"] || null,
  });

  if (req.method !== "POST") {
    console.warn("[SPLITCHAIN] 405 Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // načítanie JSON tela
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        console.error("[SPLITCHAIN] JSON parse failed");
        body = {};
      }
    }

    const { paymentIntentId, amount, currency, split } = body || {};
    if (!paymentIntentId || typeof amount !== "number" || !currency) {
      console.error("[SPLITCHAIN] BAD PAYLOAD", { paymentIntentId, amount, currency });
      return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
    }

    // idempotencia
    if (seenPayments.has(paymentIntentId)) {
      console.log("[SPLITCHAIN] DEDUP", paymentIntentId);
      return res.status(200).json({ ok: true, deduped: true });
    }
    seenPayments.add(paymentIntentId);

    const upperCurrency = currency.toUpperCase();

    // ak Stripe_webhook neposlal split objekt, vypočítame ho tu (30/30/30/10)
    const computedSplit = split || {
      printify: round2(amount * 0.3),
      crypto: round2(amount * 0.3),
      profit: round2(amount * 0.3),
      fees: round2(amount * 0.1),
    };

    console.log("[SPLITCHAIN] 💰 Rozdelenie", computedSplit);

    // 1️⃣ Printify časť — len evidencia, môžeš neskôr doplniť API call
    const printifyResult = {
      status: "reserved",
      note: `Keep ${computedSplit.printify} ${upperCurrency} for Printify.`,
    };

    // 2️⃣ Crypto časť — voliteľné (ak máš coinbase_send alebo Circle integráciu)
    let cryptoResult = { skipped: true };
    if ((process.env.ENABLE_CRYPTO_SEND ?? "false").toLowerCase() === "true") {
      try {
        const baseURL =
          process.env.BASE_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        const r = await fetch(`${baseURL}/api/coinbase_send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eurAmount: computedSplit.crypto,
            to: process.env.CONTRACT_ADDRESS,
            clientRef: paymentIntentId,
          }),
        });
        const text = await r.text();
        cryptoResult = { ok: r.ok, status: r.status, preview: text.slice(0, 300) };
      } catch (e) {
        cryptoResult = { ok: false, error: e?.message || String(e) };
      }
    }

    // 3️⃣ Profit + Fees — voliteľné pingy na Revolut alebo vlastný účet
    let profitResult = { skipped: true };
    let feesResult = { skipped: true };
    if (process.env.REVOLUT_PROFIT_URL) {
      try {
        const r = await fetch(process.env.REVOLUT_PROFIT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: computedSplit.profit,
            currency: upperCurrency,
            ref: paymentIntentId,
          }),
        });
        profitResult = { ok: r.ok, status: r.status };
      } catch (e) {
        profitResult = { ok: false, error: e?.message || String(e) };
      }
    }

    if (process.env.REVOLUT_FEES_URL) {
      try {
        const r = await fetch(process.env.REVOLUT_FEES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: computedSplit.fees,
            currency: upperCurrency,
            ref: paymentIntentId,
          }),
        });
        feesResult = { ok: r.ok, status: r.status };
      } catch (e) {
        feesResult = { ok: false, error: e?.message || String(e) };
      }
    }

    // 4️⃣ voliteľne Stripe Payout (ak chceš vyplácať zostatok)
    let stripePayoutResult = { skipped: true };
    if ((process.env.ENABLE_STRIPE_PAYOUT ?? "false").toLowerCase() === "true") {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const payout = await stripe.payouts.create({
          amount: Math.round(computedSplit.profit * 100),
          currency: upperCurrency.toLowerCase(),
        });
        stripePayoutResult = { ok: true, payoutId: payout.id, status: payout.status };
      } catch (e) {
        stripePayoutResult = { ok: false, error: e?.message || String(e) };
      }
    }

    const result = {
      ok: true,
      paymentIntentId,
      split: computedSplit,
      results: {
        printify: printifyResult,
        crypto: cryptoResult,
        profit: profitResult,
        fees: feesResult,
        stripePayout: stripePayoutResult,
      },
    };

    console.log("[SPLITCHAIN] ✅ DONE", result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[SPLITCHAIN] FATAL", err?.message);
    return res.status(500).json({ error: "Splitchain failed", detail: err?.message });
  }
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}