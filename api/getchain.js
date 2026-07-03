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
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing PRINTIFY_API_KEY" });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      version: "chainvers-full-catalog-v1"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const action = body.action || "create_product";
    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };

    async function safeJson(resp) {
      const text = await resp.text();
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return resp;
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`Fetch failed: ${e.message}`);
      }
    }

    async function loadBlueprints() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);
      if (!resp.ok || !Array.isArray(data)) throw new Error("Catalog failed");
      return data;
    }

    async function loadProviders(blueprintId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);
      if (!resp.ok || !Array.isArray(data)) throw new Error("Providers failed");
      return data;
    }

    async function loadVariants(blueprintId, providerId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);
      if (!resp.ok) throw new Error("Variants failed");
      return data || {};
    }

    function unique(arr) {
      return [...new Set(arr.filter(Boolean))];
    }

    function splitVariant(title = "") {
      const parts = title.split(/[\/|,]/g).map(v => v.trim());

      let size = "";
      let color = "";

      const sizeRe = /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i;

      for (const p of parts) {
        if (!size && sizeRe.test(p)) size = p;
      }

      for (const p of parts) {
        if (p !== size) {
          color = p;
          break;
        }
      }

      return {
        size: size || "Default",
        color: color || "Default"
      };
    }

    if (action === "mockchain_catalog") {

      const blueprints = await loadBlueprints();
      const products = [];

      for (const bp of blueprints) {

        try {

          const title = (bp.title || "").toLowerCase();

          // len unisex produkty
          if (!title.includes("unisex")) continue;

          // filter bordelu
          if (
            title.includes("kid") ||
            title.includes("baby") ||
            title.includes("pet")
          ) continue;

          const providers = await loadProviders(bp.id);

          for (const provider of providers) {

            try {

              const variantsData = await loadVariants(bp.id, provider.id);
              const variants = variantsData?.variants || [];

              if (!variants.length) continue;

              const normalized = variants.map(v => {
                const s = splitVariant(v.title || "");
                return {
                  id: v.id,
                  title: v.title,
                  size: s.size,
                  color: s.color
                };
              });

              // FIX obrázkov
              let image = null;

              if (Array.isArray(bp.images)) {
                const img = bp.images.find(i => i.src || i.url);
                if (img) image = img.src || img.url;
              }

              products.push({
                key: `${bp.id}_${provider.id}`,
                label: bp.title,
                blueprint_id: bp.id,
                print_provider_id: provider.id,
                print_provider_title: provider.title || "",
                thumbnail: image,
                variants: normalized,
                sizes: unique(normalized.map(v => v.size)),
                colors: unique(normalized.map(v => v.color))
              });

            } catch {}
          }

        } catch {}
      }

      return res.status(200).json({
        ok: true,
        products,
        count: products.length
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