import { runSplit } from "../shared/splitchain.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { paymentIntentId, amount, currency } = req.body || {};

  try {
    const result = await runSplit({ paymentIntentId, amount, currency });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[splitchain] handler failed", err);
    const status = err?.message?.includes("Missing") ? 400 : 500;
    return res.status(status).json({ error: err?.message || String(err) });
  }
}
