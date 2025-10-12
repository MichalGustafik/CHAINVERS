export default async function handler(req, res) {
  const base = process.env.CIRCLE_BASE || "https://api.circle.com";
  const r = await fetch(`${base}/v1/ping`, {
    headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` }
  });
  const data = await r.json();
  res.status(r.status).json(data);
}
