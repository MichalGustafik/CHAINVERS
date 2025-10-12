export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    where: "API alive",
    ts: Date.now(),
    url: req.url,
    method: req.method,
    vercel_url: process.env.VERCEL_URL || null
  });
}
