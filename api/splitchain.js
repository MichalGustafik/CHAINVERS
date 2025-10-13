// pages/api/splitchain.js
// CHAINVERS — simplified SplitChain v2
// 30% Printify reserve + 70% Revolut (zisk + fees), optional crypto leg.

const seenPayments = new Set();

export default async function handler(req, res) {
  console.log("[SPLITCHAIN] START", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
  });

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    // bezpečne načítaj JSON telo
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        console.error("[SPLITCHAIN] JSON parse fail");
        body = {};
      }
    }

    const { paymentIntentId, amount, currency } = body || {};
    if (!paymentIntentId || typeof amount !== "number" || !currency)
      return res.status(400).json({ error: "Missing data" });

    if (seenPayments.has(paymentIntentId))
      return res.status(200).json({ ok: true, deduped: true });
    seenPayments.add(paymentIntentId);

    const upperCurrency = currency.toUpperCase();

    // tvoje nové percentá
    const P_PRINTIFY = 0.3;
    const P_REVOLUT  = 0.7;

    const split = {
      printify: round2(amount * P_PRINTIFY),
      revolut:  round2(amount * P_REVOLUT),
    };
    console.log("[SPLITCHAIN] 💰 Rozdelenie", split);

    // 1️⃣ Printify (len evidencia)
    const printifyResult = {
      status: "reserved",
      note: `Keep ${split.printify} ${upperCurrency} ready for Printify.`,
    };

    // 2️⃣ Revolut – voliteľné pingnutie endpointu (všetko Stripe pošle na Revolut)
    let revolutResult = { skipped: true };
    if (process.env.REVOLUT_PROFIT_URL) {
      try {
        const r = await fetch(process.env.REVOLUT_PROFIT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: split.revolut,
            currency: upperCurrency,
            ref: paymentIntentId,
          }),
        });
        revolutResult = { ok: r.ok, status: r.status };
      } catch (e) {
        revolutResult = { ok: false, error: e?.message || String(e) };
      }
    }

    // 3️⃣ voliteľný crypto krok (ak ENABLE_CRYPTO_SEND = true)
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
            eurAmount: split.printify, // napr. použi printify časť ako zdroj
            to: process.env.CONTRACT_ADDRESS,
            clientRef: paymentIntentId,
          }),
        });
        const text = await r.text();
        cryptoResult = { ok: r.ok, status: r.status, preview: text.slice(0, 200) };
      } catch (e) {
        cryptoResult = { ok: false, error: e?.message || String(e) };
      }
    }

    const result = {
      ok: true,
      paymentIntentId,
      split,
      results: {
        printify: printifyResult,
        revolut: revolutResult,
        crypto: cryptoResult,
      },
    };

    console.log("[SPLITCHAIN] ✅ DONE", result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[SPLITCHAIN] FATAL", err?.message);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}