// pages/api/splitchain.js
const seenPayments = new Set();
function round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }

export default async function handler(req, res) {
  console.log("[SPLITCHAIN] START", { method: req.method, url: req.url });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const { paymentIntentId, amount, currency, split } = body || {};
    if (!paymentIntentId || typeof amount !== "number" || !currency)
      return res.status(400).json({ error: "Missing paymentIntentId, amount or currency" });

    if (seenPayments.has(paymentIntentId)) return res.status(200).json({ ok: true, deduped: true });
    seenPayments.add(paymentIntentId);

    const upper = String(currency).toUpperCase();
    const finalSplit = split || { printify: round2(amount * 0.30), revolut: round2(amount * 0.70) };
    console.log("[SPLITCHAIN] 💰 Split", { amount, currency: upper, finalSplit });

    const printifyResult = { status: "reserved", note: `Keep ${finalSplit.printify} ${upper} for Printify.` };

    let revolutResult = { skipped: true };
    if (process.env.REVOLUT_PROFIT_URL) {
      try {
        const r = await fetch(process.env.REVOLUT_PROFIT_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: finalSplit.revolut, currency: upper, ref: paymentIntentId }),
        });
        revolutResult = { ok: r.ok, status: r.status };
      } catch (e) { revolutResult = { ok: false, error: e?.message || String(e) }; }
    }

    // log stage
    try {
      const baseURL = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      if (baseURL) await fetch(`${baseURL}/api/chainpospaidlog`, {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ userId:"anon", sessionId: paymentIntentId, stage:"SPLIT.DONE", data: { split: finalSplit } })
      });
    } catch {}

    return res.status(200).json({ ok: true, paymentIntentId, split: finalSplit, results: { printify: printifyResult, revolut: revolutResult } });
  } catch (err) {
    console.error("[SPLITCHAIN] FATAL", err?.message);
    return res.status(500).json({ error: "Splitchain failed", detail: err?.message });
  }
}