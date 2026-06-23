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
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers:authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error(`Providers failed: ${JSON.stringify(data)}`);
      }

      return Array.isArray(data) ? data : [];
    }

    async function loadVariants(blueprintId, providerId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
        { headers:authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error(`Variants failed: ${JSON.stringify(data)}`);
      }

      return data || {};
    }

    function isGoodTee(bp) {
      const t = String(bp.title || "").toLowerCase();
      return (
        t.includes("unisex") &&
        (t.includes("t-shirt") || t.includes("tee")) &&
        !t.includes("kids") &&
        !t.includes("youth") &&
        !t.includes("hoodie") &&
        !t.includes("sweatshirt")
      );
    }

    function isGoodTank(bp) {
      const t = String(bp.title || "").toLowerCase();
      return (
        t.includes("unisex") &&
        (t.includes("tank") || t.includes("sleeveless")) &&
        !t.includes("kids") &&
        !t.includes("youth")
      );
    }

    async function normalizeProduct(bp) {
      const providers = await loadProviders(bp.id);
      const provider = providers?.[0];

      if (!provider?.id) return null;

      const variantsData = await loadVariants(bp.id, provider.id);
      const variants = Array.isArray(variantsData.variants) ? variantsData.variants : [];

      if (!variants.length) return null;

      const normalizedVariants = variants.map(v => {
        const split = splitVariantTitle(v.title || "");

        return {
          id: v.id,
          title: v.title || `Variant ${v.id}`,
          size: split.size,
          color: split.color,
          is_enabled: v.is_enabled !== false
        };
      });

      return {
        key: `${bp.id}_${provider.id}`,
        label: bp.title || `Printify produkt ${bp.id}`,
        blueprint_id: bp.id,
        blueprint_title: bp.title || `Blueprint ${bp.id}`,
        print_provider_id: provider.id,
        print_provider_title: provider.title || provider.name || `Provider ${provider.id}`,
        thumbnail: extractBlueprintThumb(bp),
        variants: normalizedVariants,
        sizes: uniqueClean(normalizedVariants.map(v => v.size)),
        colors: uniqueClean(normalizedVariants.map(v => v.color)),
        print_areas: variantsData.print_areas || []
      };
    }

    function placementToPosition(printAreas = []) {
      const positions = [];

      for (const area of printAreas || []) {
        for (const p of area?.placeholders || []) {
          if (p?.position) positions.push(String(p.position));
        }
      }

      return (
        positions.find(p => p === "front") ||
        positions.find(p => p.includes("front")) ||
        positions[0] ||
        "front"
      );
    }

    if (action === "mockchain_catalog") {
      const blueprints = await loadBlueprints();

      const tee = blueprints.find(isGoodTee);
      const tank = blueprints.find(isGoodTank);

      const products = [];

      if (tee) {
        const p = await normalizeProduct(tee);
        if (p) products.push(p);
      }

      if (tank) {
        const p = await normalizeProduct(tank);
        if (p) products.push(p);
      }

      return res.status(200).json({
        ok:true,
        products,
        count:products.length
      });
    }

    if (action === "preview_status") {
      const { product_id } = body;

      if (!product_id) {
        return res.status(400).json({ ok:false, error:"Missing product_id" });
      }

      const shopId = await getShopId();

      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/shops/${shopId}/products/${product_id}.json`,
        { headers:authHeader },
        12000
      );

      const product = await safeJson(resp);

      if (!resp.ok || !product?.id) {
        return res.status(500).json({ ok:false, error:"Product fetch failed", resp:product });
      }

      const preview = extractPreview(product);

      return res.status(200).json({
        ok:true,
        product,
        product_id:product.id,
        preview,
        preview_url:preview,
        mockup_pending:!preview
      });
    }

    const {
      crop_id,
      image_url,
      blueprint_id,
      print_provider_id,
      variant_id,
      product_type,
      size,
      color,
      note
    } = body;

    if (!crop_id || !image_url) {
      return res.status(400).json({ ok:false, error:"Missing crop_id or image_url" });
    }

    const shopId = await getShopId();

    const imageResp = await fetchWithTimeout(image_url, {}, 10000);

    if (!imageResp.ok) {
      return res.status(500).json({
        ok:false,
        error:"Image download failed",
        status:imageResp.status,
        image_url
      });
    }

    const imageBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");

    const uploadResp = await fetchWithTimeout(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method:"POST",
        headers:{
          ...authHeader,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          file_name:`${crop_id}.jpg`,
          contents:imageBase64
        })
      },
      20000
    );

    const uploadData = await safeJson(uploadResp);

    if (!uploadResp.ok || !uploadData.id) {
      return res.status(500).json({ ok:false, error:"Upload failed", resp:uploadData });
    }

    const variantsData = await loadVariants(blueprint_id, print_provider_id);
    const variants = Array.isArray(variantsData.variants) ? variantsData.variants : [];

    let variant = variants.find(v => String(v.id) === String(variant_id)) || variants[0];

    if (!variant) {
      return res.status(500).json({ ok:false, error:"No variant found", resp:variantsData });
    }

    const placeholderPosition = placementToPosition(variantsData.print_areas || []);

    const productPayload = {
      title:`CHAINVERS ${product_type || "Printify produkt"} ${crop_id}`,
      description:
        `CHAINVERS produkt\\n\\n` +
        `Typ produktu: ${product_type || ""}\\n` +
        `Veľkosť: ${size || ""}\\n` +
        `Farba: ${color || ""}\\n` +
        `Poznámka: ${note || ""}`,
      blueprint_id:Number(blueprint_id),
      print_provider_id:Number(print_provider_id),
      variants:[
        {
          id:Number(variant.id),
          price:2000,
          is_enabled:true
        }
      ],
      print_areas:[
        {
          variant_ids:[Number(variant.id)],
          placeholders:[
            {
              position:placeholderPosition,
              images:[
                {
                  id:uploadData.id,
                  x:0.5,
                  y:0.5,
                  scale:1,
                  angle:0
                }
              ]
            }
          ]
        }
      ],
      external_id:`chainvers_${crop_id}_${Date.now()}`
    };

    const createResp = await fetchWithTimeout(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method:"POST",
        headers:{
          ...authHeader,
          "Content-Type":"application/json"
        },
        body:JSON.stringify(productPayload)
      },
      22000
    );

    const product = await safeJson(createResp);

    if (!createResp.ok || !product.id) {
      return res.status(500).json({
        ok:false,
        error:"Product creation failed",
        resp:product
      });
    }

    const preview = extractPreview(product);

    return res.status(200).json({
      ok:true,
      product,
      product_id:product.id,
      preview,
      preview_url:preview,
      printify_product_id:product.id,
      printify_status:"product_created",
      selected:{
        blueprint_id,
        print_provider_id,
        variant_id:variant.id,
        variant_title:variant.title || null,
        placeholder:placeholderPosition
      }
    });

  } catch (e) {
    return res.status(500).json({
      ok:false,
      error:e.message || String(e)
    });
  }
}
