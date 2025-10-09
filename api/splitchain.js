// /api/splitchain.js
import Stripe from "stripe";

/**
 * ENV (Vercel → Settings → Environment Variables)
 *
 *  STRIPE_SECRET_KEY=sk_live_...
 *
 *  // percentá – ak nesedia na 1.0, normalizujeme
 *  SPLIT_PRINTIFY_PERCENT=0.50
 *  SPLIT_ETH_PERCENT=0.30
 *  SPLIT_PROFIT_PERCENT=0.20
 *
 *  // Profit výplata (Stripe payouts)
 *  ENABLE_STRIPE_PAYOUT=true
 *
 *  // ETH časť (voliteľné – doplň Coinbase implementáciu alebo vlastný sender)
 *  ENABLE_COINBASE_ETH=false
 *  CONTRACT_ADDRESS=0xTvojaAdresaAleboKontrakt
 *  COINBASE_API_KEY=...
 *  COINBASE_API_SECRET=...
 *  COINBASE_API_PASSPHRASE=...      // ak používaš Exchange/Pro
 *  COINBASE_API_BASE=https://api.coinbase.com
 */

const seenPayments = new Set(); // jednoduchý in-memory idempotency guard

export default async function handler(req, res) {
  const startedAt = Date.now();
  console.log("➡️  [SPLITCHAIN] Incoming", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
  });

  if (req.method !== "POST") {
    console.warn("⚠️  [SPLITCHAIN] Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { paymentIntentId, amount, currency } = req.body || {};
    if (!paymentIntentId || typeof amount !== "number" || !currency) {
      console.error("❌  [SPLITCHAIN] Invalid payload", { body: req.body });
      return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
    }

    // idempotencia
    if (seenPayments.has(paymentIntentId)) {
      console.log("♻️  [SPLITCHAIN] Deduped", { paymentIntentId });
      return res.status(200).json({ status: "ok", deduped: true });
    }
    seenPayments.add(paymentIntentId);

    // načítaj percentá (defaulty)
    const pPrintify = parseFloat(process.env.SPLIT_PRINTIFY_PERCENT ?? "0.50");
    const pEth      = parseFloat(process.env.SPLIT_ETH_PERCENT ?? "0.30");
    const pProfit   = parseFloat(process.env.SPLIT_PROFIT_PERCENT ?? "0.20");

    const sum = pPrintify + pEth + pProfit || 1.0;
    const norm = (p) => p / sum;

    const split = {
      printify: round2(amount * norm(pPrintify)),
      eth:      round2(amount * norm(pEth)),
      profit:   round2(amount * norm(pProfit)),
    };

    const upperCurrency = String(currency).toUpperCase();

    console.log("🧮  [SPLITCHAIN] Computed split", {
      paymentIntentId,
      amount,
      currency: upperCurrency,
      split,
      percents: { pPrintify, pEth, pProfit },
    });

    // 1) PRINTIFY "reserve" — iba evidencia/log
    const printifyResult = {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} available for Printify card charges.`,
    };
    console.log("🗂️  [SPLITCHAIN] Printify reserve", printifyResult);

    // 2) ETH časť (voliteľné) — volaj svoj sender (napr. náš /api/coinbase_send)
    let ethResult = { skipped: true, reason: "ENABLE_COINBASE_ETH is false" };
    const enableEth = (process.env.ENABLE_COINBASE_ETH ?? "false").toLowerCase() === "true";
    if (enableEth) {
      const to = process.env.CONTRACT_ADDRESS;
      if (!to) {
        ethResult = { ok: false, error: "CONTRACT_ADDRESS not set" };
        console.error("🚨  [SPLITCHAIN] ETH failed – CONTRACT_ADDRESS missing");
      } else if (split.eth <= 0) {
        ethResult = { skipped: true, reason: "ETH amount <= 0" };
        console.warn("⚠️  [SPLITCHAIN] ETH skipped – amount <= 0");
      } else {
        try {
          // odporúčané: volať vlastný interný endpoint /api/coinbase_send
          const base =
            process.env.BASE_URL
              || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
          if (!base) throw new Error("Missing BASE_URL or VERCEL_URL for coinbase_send");

          const r = await fetch(`${base}/api/coinbase_send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eurAmount: split.eth,
              to,
              clientRef: paymentIntentId, // idempotencia naprieč systémami
            }),
          });
          ethResult = await r.json();
          console.log("🟢  [SPLITCHAIN] ETH result", ethResult);
        } catch (e) {
          ethResult = { ok: false, error: e?.message || String(e) };
          console.error("🚨  [SPLITCHAIN] ETH part failed", ethResult);
        }
      }
    }

    // 3) PROFIT payout cez Stripe (voliteľné)
    let payoutResult = { skipped: true, reason: "ENABLE_STRIPE_PAYOUT is false" };
    const enablePayout = (process.env.ENABLE_STRIPE_PAYOUT ?? "false").toLowerCase() === "true";
    if (enablePayout) {
      if (split.profit <= 0) {
        payoutResult = { skipped: true, reason: "profit amount <= 0" };
        console.warn("⚠️  [SPLITCHAIN] Payout skipped – amount <= 0");
      } else {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          // potrebuješ mať v Stripe pridaný/verifikovaný externý bank account
          const payout = await stripe.payouts.create({
            amount: Math.round(split.profit * 100), // v centoch
            currency: upperCurrency.toLowerCase(),
          });
          payoutResult = { ok: true, payoutId: payout.id, status: payout.status };
          console.log("🟢  [SPLITCHAIN] Payout created", payoutResult);
        } catch (e) {
          payoutResult = { ok: false, error: e?.message || String(e) };
          console.error("🚨  [SPLITCHAIN] Payout failed", payoutResult);
        }
      }
    }

    const resp = {
      status: "ok",
      paymentIntentId,
      input: { amount, currency: upperCurrency },
      split,
      results: { printify: printifyResult, eth: ethResult, profit: payoutResult },
      ms: Date.now() - startedAt,
      idempotent: true,
    };

    console.log("✅  [SPLITCHAIN] Done", resp);
    return res.status(200).json(resp);
  } catch (err) {
    console.error("🚨  [SPLITCHAIN] Handler error", { message: err?.message, stack: err?.stack });
    return res.status(500).json({ error: "Splitchain failed", detail: err?.message });
  }
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
