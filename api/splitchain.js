import Stripe from "stripe";

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
    let { paymentIntentId, amount, currency } = req.body || {};
    console.log("📥  [SPLITCHAIN] Raw body", req.body);

    // ➜ Ak prišiel priamo Stripe event (object: 'event'), vyparsuj checkout.session.*
    if (!paymentIntentId && req.body?.object === "event") {
      const evt = req.body;
      console.log("🔎  [SPLITCHAIN] Detected Stripe Event", {
        eventId: evt.id,
        type: evt.type,
        livemode: evt.livemode,
      });

      // zaujímajú nás tieto typy
      const okTypes = new Set([
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ]);

      if (okTypes.has(evt.type)) {
        const session = evt.data?.object;
        if (session?.object === "checkout.session") {
          paymentIntentId = session.payment_intent;
          amount = typeof session.amount_total === "number" ? session.amount_total / 100 : undefined;
          currency = session.currency?.toUpperCase?.();
          console.log("🧩  [SPLITCHAIN] Extracted from Stripe event", {
            paymentIntentId, amount, currency,
          });
        }
      }
    }

    if (!paymentIntentId || typeof amount !== "number" || !currency) {
      console.error("❌  [SPLITCHAIN] Invalid payload", { paymentIntentId, amount, currency });
      return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });
    }

    // idempotencia
    if (seenPayments.has(paymentIntentId)) {
      console.log("♻️  [SPLITCHAIN] Duplicate payment, skipping", { paymentIntentId });
      return res.status(200).json({ ok: true, deduped: true });
    }
    seenPayments.add(paymentIntentId);

    // percentá
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

    console.log("🧮  [SPLITCHAIN] Split computed", {
      paymentIntentId,
      amount,
      currency: upperCurrency,
      percents: { pPrintify, pEth, pProfit },
      split,
    });

    // 1) Printify "reserve" (len evidencia/log)
    const printifyResult = {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} on Printify card.`,
    };
    console.log("🗂️  [SPLITCHAIN] Printify reserve", printifyResult);

    // 2) ETH (voliteľné)
    let ethResult = { skipped: true };
    if ((process.env.ENABLE_COINBASE_ETH ?? "false").toLowerCase() === "true") {
      const address = process.env.CONTRACT_ADDRESS;
      if (!address) {
        console.error("🚨  [SPLITCHAIN] Missing CONTRACT_ADDRESS for ETH");
      } else {
        try {
          const base =
            process.env.BASE_URL
            || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
          if (!base) throw new Error("Missing BASE_URL or VERCEL_URL for coinbase_send");

          const r = await fetch(`${base}/api/coinbase_send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eurAmount: split.eth,
              to: address,
              clientRef: paymentIntentId,
            }),
          });
          ethResult = await r.json();
          console.log("🟢  [SPLITCHAIN] ETH result", ethResult);
        } catch (e) {
          ethResult = { ok: false, error: e?.message || String(e) };
          console.error("🚨  [SPLITCHAIN] ETH error", ethResult);
        }
      }
    }

    // 3) Profit payout (voliteľné)
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
        payoutResult = { ok: false, error: e?.message || String(e) };
        console.error("🚨  [SPLITCHAIN] Stripe payout failed", payoutResult);
      }
    }

    const response = {
      ok: true,
      paymentIntentId,
      split,
      results: { printify: printifyResult, eth: ethResult, profit: payoutResult },
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
