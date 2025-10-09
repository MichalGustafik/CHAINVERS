// /api/splitchain.js
import Stripe from "stripe";

/**
 * ENV premenné (Vercel → Project → Settings → Environment Variables):
 *
 *  STRIPE_SECRET_KEY=sk_live_...
 *  STRIPE_WEBHOOK_SECRET=whsec_...              // (nepoužité tu, ale máš ho vo webhooku)
 *
 *  // percentá – ak nesedí súčet na 1.0, skript ich normalizuje
 *  SPLIT_PRINTIFY_PERCENT=0.50
 *  SPLIT_ETH_PERCENT=0.30
 *  SPLIT_PROFIT_PERCENT=0.20
 *
 *  // Profit výplata (Stripe payouts) – vyžaduje pridaný/verifikovaný externý účet v Stripe
 *  ENABLE_STRIPE_PAYOUT=true
 *
 *  // ETH výplata (voliteľné) – doplň svoju Coinbase implementáciu v označenej časti
 *  ENABLE_COINBASE_ETH=false
 *  CONTRACT_ADDRESS=0xTvojaAdresaAleboKontrakt   // kam posielať ETH podiel
 *  COINBASE_API_KEY=...                          // ak používaš Coinbase API
 *  COINBASE_API_SECRET=...                       // ak používaš Coinbase API
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

    // idempotency (ochrana proti opakovanému spracovaniu tej istej platby)
    if (seenPayments.has(paymentIntentId)) {
      console.log("♻️  [SPLITCHAIN] Deduped", { paymentIntentId });
      return res.status(200).json({ status: "ok", deduped: true });
    }
    seenPayments.add(paymentIntentId);

    // Percentá z ENV (defaulty, ak nie sú nastavené)
    const pPrintify = parseFloat(process.env.SPLIT_PRINTIFY_PERCENT ?? "0.50");
    const pEth      = parseFloat(process.env.SPLIT_ETH_PERCENT ?? "0.30");
    const pProfit   = parseFloat(process.env.SPLIT_PROFIT_PERCENT ?? "0.20");

    let sumP = pPrintify + pEth + pProfit;
    if (!isFinite(sumP) || sumP <= 0) {
      console.warn("⚠️  [SPLITCHAIN] Invalid percents, using defaults 0.5/0.3/0.2");
      sumP = 1.0;
    }

    const normalize = (p) => p / (pPrintify + pEth + pProfit || 1);
    const split = {
      printify: round2(amount * normalize(pPrintify)),
      eth:      round2(amount * normalize(pEth)),
      profit:   round2(amount * normalize(pProfit)),
    };

    const upperCurrency = String(currency).toUpperCase();

    console.log("🧮  [SPLITCHAIN] Computed split", {
      paymentIntentId,
      input: { amount, currency: upperCurrency },
      split,
      percents: { pPrintify, pEth, pProfit },
    });

    // === 1) PRINTIFY "reserve" (iba evidujeme/logujeme) ======================
    // Kredit Printify sa nedobíja cez API – pri objednávke si ho stiahnu z priradenej karty.
    const printifyResult = {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} available to cover Printify charges from card on file.`,
    };
    console.log("🗂️  [SPLITCHAIN] Printify reserve", printifyResult);

    // === 2) ETH cez Coinbase API (VOLITEĽNÉ – doplň implementáciu) ===========
    let ethResult = { skipped: true, reason: "ENABLE_COINBASE_ETH is false" };
    const enableEth = (process.env.ENABLE_COINBASE_ETH ?? "false").toLowerCase() === "true";
    if (enableEth) {
      const toAddress = process.env.CONTRACT_ADDRESS;
      if (!toAddress) {
        ethResult = { ok: false, error: "CONTRACT_ADDRESS not set" };
        console.error("🚨  [SPLITCHAIN] ETH failed – CONTRACT_ADDRESS missing");
      } else if (split.eth <= 0) {
        ethResult = { skipped: true, reason: "ETH amount <= 0" };
        console.warn("⚠️  [SPLITCHAIN] ETH skipped – amount <= 0");
      } else {
        try {
          // 👇 Sem doplň svoju Coinbase implementáciu (Advanced Trade / Exchange / Commerce)
          // 1) Nakúpiť ETH za EUR (alebo použiť existujúci zostatok)
          // 2) Odoslať ETH na toAddress
          //
          // Príklad štruktúry výsledku:
          // const tx = await coinbaseSendETH({ eurAmount: split.eth, to: toAddress });
          const tx = { id: "TODO-CB-TX", to: toAddress, eurAmount: split.eth };
          ethResult = { ok: true, tx };
          console.log("🟢  [SPLITCHAIN] ETH part processed (placeholder)", tx);
        } catch (e) {
          ethResult = { ok: false, error: e?.message || String(e) };
          console.error("🚨  [SPLITCHAIN] ETH part failed", ethResult);
        }
      }
    }

    // === 3) PROFIT payout cez Stripe (VOLITEĽNÉ) =============================
    let payoutResult = { skipped: true, reason: "ENABLE_STRIPE_PAYOUT is false" };
    const enablePayout = (process.env.ENABLE_STRIPE_PAYOUT ?? "false").toLowerCase() === "true";
    if (enablePayout) {
      if (split.profit <= 0) {
        payoutResult = { skipped: true, reason: "profit amount <= 0" };
        console.warn("⚠️  [SPLITCHAIN] Payout skipped – amount <= 0");
      } else {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          // Musíš mať pridaný/verifikovaný externý bank account v Stripe
          const payout = await stripe.payouts.create({
            amount: Math.round(split.profit * 100),             // v centoch
            currency: upperCurrency.toLowerCase(),              // 'eur'
            // statement_descriptor: "CHAINVERS PROFIT",        // voliteľne
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
      results: {
        printify: printifyResult,
        eth: ethResult,
        profit: payoutResult,
      },
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

// helpers
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
