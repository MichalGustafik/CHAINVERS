import Stripe from "stripe";

export const config = {
  runtime: "nodejs18.x",
};

/**
 * ENV (Vercel → Project → Settings → Environment Variables)
 *
 * STRIPE_SECRET_KEY=sk_live_...
 * SPLIT_PRINTIFY_PERCENT=0.50
 * SPLIT_ETH_PERCENT=0.30
 * SPLIT_PROFIT_PERCENT=0.20
 *
 * ENABLE_STRIPE_PAYOUT=true
 * ENABLE_COINBASE_ETH=false
 * CONTRACT_ADDRESS=0xTvojaAdresaAleboKontrakt
 * BASE_URL=https://chainvers.vercel.app
 */

const seenPayments = new Set();

export default async function handler(req, res) {
  const start = Date.now();
  console.log("➡️  [SPLITCHAIN] Incoming request", {
    method: req.method,
    url: req.url,
    headers: {
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"],
    },
  });

  if (req.method !== "POST") {
    console.warn("⚠️  [SPLITCHAIN] Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- Parse body
    const { paymentIntentId, amount, currency } = req.body || {};
    console.log("📥  [SPLITCHAIN] Raw body", req.body);

    if (!paymentIntentId || typeof amount !== "number" || !currency) {
      console.error("❌  [SPLITCHAIN] Invalid payload", { paymentIntentId, amount, currency });
      return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
    }

    // ---- Idempotency
    if (seenPayments.has(paymentIntentId)) {
      console.log("♻️  [SPLITCHAIN] Duplicate payment, skipping", { paymentIntentId });
      return res.status(200).json({ ok: true, deduped: true });
    }
    seenPayments.add(paymentIntentId);

    // ---- Percent splitting
    const pPrintify = parseFloat(process.env.SPLIT_PRINTIFY_PERCENT ?? "0.50");
    const pEth = parseFloat(process.env.SPLIT_ETH_PERCENT ?? "0.30");
    const pProfit = parseFloat(process.env.SPLIT_PROFIT_PERCENT ?? "0.20");
    const total = pPrintify + pEth + pProfit || 1;

    const split = {
      printify: round2(amount * (pPrintify / total)),
      eth: round2(amount * (pEth / total)),
      profit: round2(amount * (pProfit / total)),
    };
    const upperCurrency = String(currency).toUpperCase();

    console.log("🧮  [SPLITCHAIN] Split computed", {
      paymentIntentId,
      amount,
      currency: upperCurrency,
      percents: { pPrintify, pEth, pProfit },
      split,
    });

    // ---- 1) PRINTIFY reserve
    const printifyResult = {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} on Printify card.`,
    };
    console.log("🗂️  [SPLITCHAIN] Printify reserve", printifyResult);

    // ---- 2) ETH transfer (optional)
    let ethResult = { skipped: true };
    if ((process.env.ENABLE_COINBASE_ETH ?? "false").toLowerCase() === "true") {
      const address = process.env.CONTRACT_ADDRESS;
      if (!address) {
        console.error("🚨  [SPLITCHAIN] Missing CONTRACT_ADDRESS for ETH");
      } else {
        try {
          const r = await fetch(`${process.env.BASE_URL}/api/coinbase_send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eurAmount: split.eth,
              to: address,
              clientRef: paymentIntentId,
            }),
          });
          ethResult = await r.json();
          console.log("🟢  [SPLITCHAIN] ETH sent", ethResult);
        } catch (e) {
          console.error("🚨  [SPLITCHAIN] ETH error", e);
          ethResult = { ok: false, error: e.message };
        }
      }
    }

    // ---- 3) PROFIT payout (optional)
    let payoutResult = { skipped: true };
    if ((process.env.ENABLE_STRIPE_PAYOUT ?? "false").toLowerCase() === "true") {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const payout = await stripe.payouts.create({
          amount: Math.round(split.profit * 100),
          currency: upperCurrency.toLowerCase(),
        });
        payoutResult = { ok: true, payoutId: payout.id, status: payout.status };
        console.log("🟢  [SPLITCHAIN] Stripe payout", payoutResult);
      } catch (e) {
        console.error("🚨  [SPLITCHAIN] Stripe payout failed", e);
        payoutResult = { ok: false, error: e.message };
      }
    }

    // ---- Build response
    const response = {
      ok: true,
      paymentIntentId,
      split,
      results: {
        printify: printifyResult,
        eth: ethResult,
        profit: payoutResult,
      },
      ms: Date.now() - start,
    };

    console.log("✅  [SPLITCHAIN] Done", response);
    return res.status(200).json(response);
  } catch (err) {
    console.error("🔥  [SPLITCHAIN] Fatal error", { message: err.message, stack: err.stack });
    return res.status(500).json({ error: "Splitchain failed", detail: err.message });
  }
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}
