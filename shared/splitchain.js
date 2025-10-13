import Stripe from "stripe";

const seenPayments = new Set();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function parsePercent(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export async function runSplit({ paymentIntentId, amount, currency }) {
  if (!paymentIntentId) {
    throw new Error("Missing paymentIntentId");
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    throw new Error("Missing or invalid amount");
  }
  const upperCurrency = String(currency || "eur").toUpperCase();

  if (seenPayments.has(paymentIntentId)) {
    return {
      status: "ok",
      paymentIntentId,
      input: { amount: numericAmount, currency: upperCurrency },
      deduped: true,
      results: {
        printify: { skipped: true, reason: "duplicate payment" },
        eth: { skipped: true, reason: "duplicate payment" },
        profit: { skipped: true, reason: "duplicate payment" },
      },
      ms: 0,
      idempotent: true,
    };
  }

  const startedAt = Date.now();
  seenPayments.add(paymentIntentId);

  const pPrintify = parsePercent(process.env.SPLIT_PRINTIFY_PERCENT, 0.5);
  const pEth = parsePercent(process.env.SPLIT_ETH_PERCENT, 0.3);
  const pProfit = parsePercent(process.env.SPLIT_PROFIT_PERCENT, 0.2);

  let sum = pPrintify + pEth + pProfit;
  if (!Number.isFinite(sum) || sum <= 0) {
    console.warn("[splitchain] Invalid percentages, falling back to 50/30/20");
    sum = 1;
  }

  const normalize = (value) => value / (sum || 1);
  const split = {
    printify: round2(numericAmount * normalize(pPrintify)),
    eth: round2(numericAmount * normalize(pEth)),
    profit: round2(numericAmount * normalize(pProfit)),
  };

  const results = {
    printify: {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} available to cover Printify charges from card on file.`,
    },
    eth: { skipped: true, reason: "ENABLE_COINBASE_ETH is false" },
    profit: { skipped: true, reason: "ENABLE_STRIPE_PAYOUT is false" },
  };

  const enableEth = parseBoolean(process.env.ENABLE_COINBASE_ETH);
  if (enableEth) {
    const toAddress = process.env.CONTRACT_ADDRESS;
    if (!toAddress) {
      results.eth = { ok: false, error: "CONTRACT_ADDRESS not set" };
    } else if (split.eth <= 0) {
      results.eth = { skipped: true, reason: "ETH amount <= 0" };
    } else {
      try {
        const tx = { id: "TODO-CB-TX", to: toAddress, eurAmount: split.eth };
        results.eth = { ok: true, tx };
        console.log("[splitchain] ETH placeholder", tx);
      } catch (err) {
        results.eth = { ok: false, error: err?.message || String(err) };
      }
    }
  }

  const enablePayout = parseBoolean(process.env.ENABLE_STRIPE_PAYOUT);
  if (enablePayout) {
    if (split.profit <= 0) {
      results.profit = { skipped: true, reason: "profit amount <= 0" };
    } else if (!process.env.STRIPE_SECRET_KEY) {
      results.profit = { ok: false, error: "STRIPE_SECRET_KEY not set" };
    } else {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const payout = await stripe.payouts.create({
          amount: Math.round(split.profit * 100),
          currency: upperCurrency.toLowerCase(),
        });
        results.profit = { ok: true, payoutId: payout.id, status: payout.status };
      } catch (err) {
        results.profit = { ok: false, error: err?.message || String(err) };
      }
    }
  }

  return {
    status: "ok",
    paymentIntentId,
    input: { amount: numericAmount, currency: upperCurrency },
    split,
    results,
    ms: Date.now() - startedAt,
    idempotent: true,
  };
}

export function resetSplitchainCache() {
  seenPayments.clear();
}
