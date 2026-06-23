export const maxDuration = 60;

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://chainvers.free.nf",
    "http://chainvers.free.nf",
    "https://www.chainvers.free.nf",
    "http://www.chainvers.free.nf"
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok:false, error:"Missing PRINTIFY_API_KEY" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ ok:true, version:"mockchain-2-products-v1" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const action = body.action || "create_product";

    const authHeader = {
      Authorization: `Bearer ${PRINTIFY_API_KEY}`
    };

    async function safeJson(resp) {
      const text = await resp.text();
      try { return JSON.parse(text); }
      catch { return { raw:text }; }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, { ...options, signal:controller.signal });
        clearTimeout(timer);
        return resp;
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`Timeout/fetch failed: ${url} :: ${e.message}`);
      }
    }

    async function getShopId() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/shops.json",
        { headers:authHeader },
        9000
      );

      const shops = await safeJson(resp);
      const shopId = shops?.[0]?.id;

      if (!shopId) {
        throw new Error(`No shop found: ${JSON.stringify(shops)}`);
      }

      return shopId;
    }

    function extractPreview(product) {
      if (Array.isArray(product?.images) && product.images.length) {
        return product.images[0]?.src || product.images[0]?.url || null;
      }

      if (Array.isArray(product?.mockups) && product.mockups.length) {
        return product.mockups[0]?.src || product.mockups[0]?.url || null;
      }

      return null;
    }

    function extractBlueprintThumb(bp) {
      if (Array.isArray(bp?.images) && bp.images.length) {
        return bp.images[0]?.src || bp.images[0]?.url || null;
      }

      return bp?.image || bp?.thumbnail || bp?.display_image || null;
    }

    function uniqueClean(arr) {
      return [...new Set((arr || []).map(v => String(v || "").trim()).filter(Boolean))];
    }

    function splitVariantTitle(title = "") {
      const parts = String(title).split(/[\/|,]/g).map(v => v.trim()).filter(Boolean);

      let size = "";
      let color = "";

      const sizeRe = /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL|One size)$/i;

      for (const p of parts) {
        if (!size && sizeRe.test(p)) size = p;
      }

      for (const p of parts) {
        if (p !== size) {
          color = p;
          break;
        }
      }

      if (!size && parts.length) size = parts[parts.length - 1];
      if (!color && parts.length > 1) color = parts[0];

      return {
        size: size || "Default",
        color: color || "Default"
      };
    }

    async function loadBlueprints() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers:authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error(`Catalog failed: ${JSON.stringify(data)}`);
      }

      return Array.isArray(data) ? data : [];
    }

    async function loadProviders(blueprintId) {
      const resp = await fetchWithTimeout