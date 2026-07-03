export const maxDuration = 60;

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://chainvers.free.nf",
    "http://chainvers.free.nf",
    "https://www.chainvers.free.nf",
    "http://www.chainvers.free.nf"
  ];

  res.setHeader(
    "Access-Control-Allow-Origin",
    allowedOrigins.includes(origin) ? origin : "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing PRINTIFY_API_KEY" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const action = body.action || "";
    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };

    async function fetchJson(url) {
      const resp = await fetch(url, { headers: authHeader });
      const text = await resp.text();
      try { return JSON.parse(text); } catch { return {}; }
    }

    async function loadBlueprints() {
      return await fetchJson("https://api.printify.com/v1/catalog/blueprints.json");
    }

    // =========================
    // 🚀 STREAM KATALÓG
    // =========================
    if (action === "mockchain_catalog") {

      const blueprints = await loadBlueprints();

      const offset = Number(body.offset || 0);
      const limit = Number(body.limit || 10);

      const products = [];
      let count = 0;

      for (let i = offset; i < blueprints.length; i++) {

        const bp = blueprints[i];
        const title = (bp.title || "").toLowerCase();

        // ✅ len unisex
        if (!title.includes("unisex")) continue;

        // ❌ filter bordelu
        if (
          title.includes("kid") ||
          title.includes("baby") ||
          title.includes("pet")
        ) continue;

        // 🖼️ obrázok
        let image = null;
        if (Array.isArray(bp.images)) {
          const img = bp.images.find(i => i.src || i.url);
          if (img) image = img.src || img.url;
        }

        products.push({
          key: String(bp.id),
          label: bp.title,
          thumbnail: image,
          print_provider_title: "Printify",
          variants: []
        });

        count++;

        if (count >= limit) break;
      }

      return res.status(200).json({
        ok: true,
        products,
        nextOffset: offset + limit
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}