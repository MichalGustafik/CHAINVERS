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
    return res.status(500).json({
      ok: false,
      error: "Missing PRINTIFY_API_KEY"
    });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      version: "chainvers-getchain-full-catalog-images-v2-print-position"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const action = body.action || "create_product";
    const authHeader = {
      Authorization: `Bearer ${PRINTIFY_API_KEY}`
    };

    async function safeJson(resp) {
      const text = await resp.text();

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        clearTimeout(timer);
        return resp;
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`Fetch failed: ${e.message}`);
      }
    }

    function clampNumber(value, min, max, fallback) {
      const num = Number(value);

      if (!Number.isFinite(num)) return fallback;

      return Math.max(min, Math.min(max, num));
    }

    async function getShopId() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/shops.json",
        { headers: authHeader },
        9000
      );

      const data = await safeJson(resp);
      const shopId = data?.[0]?.id;

      if (!resp.ok || !shopId) {
        throw new Error("Printify shop not found");
      }

      return shopId;
    }

    async function loadBlueprints() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok || !Array.isArray(data)) {
        throw new Error("Printify catalog failed");
      }

      return data;
    }

    async function loadProviders(blueprintId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok || !Array.isArray(data)) {
        throw new Error("Printify providers failed");
      }

      return data;
    }

    async function loadVariants(blueprintId, providerId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error("Printify variants failed");
      }

      return data || {};
    }

    function collectImages(obj, out = []) {
      if (!obj) return out;

      if (typeof obj === "string") {
        const s = obj.trim();

        if (
          s.startsWith("http") &&
          (
            s.includes(".jpg") ||
            s.includes(".jpeg") ||
            s.includes(".png") ||
            s.includes(".webp") ||
            s.includes("printify") ||
            s.includes("mockup") ||
            s.includes("cdn")
          )
        ) {
          out.push(s);
        }

        return out;
      }

      if (Array.isArray(obj)) {
        obj.forEach(x => collectImages(x, out));
        return out;
      }

      if (typeof obj === "object") {
        Object.values(obj).forEach(v => collectImages(v, out));
      }

      return out;
    }

    function unique(arr) {
      return [
        ...new Set(
          (arr || [])
            .map(v => String(v || "").trim())
            .filter(Boolean)
        )
      ];
    }

    function splitVariant(title = "") {
      const parts = String(title)
        .split(/[\/|,]/g)
        .map(v => v.trim())
        .filter(Boolean);

      let size = "";
      let color = "";

      const sizeRe = /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i;

      for (const p of parts) {
        if (!size && sizeRe.test(p)) {
          size = p;
        }
      }

      for (const p of parts) {
        if (p !== size) {
          color = p;
          break;
        }
      }

      return {
        size: size || parts[parts.length - 1] || "Default",
        color: color || parts[0] || "Default"
      };
    }

    function extractPreview(product) {
      const found = collectImages(product);
      return found[0] || null;
    }

    function frontPlaceholder(printAreas = []) {
      const positions = [];

      for (const area of printAreas || []) {
        for (const p of area?.placeholders || []) {
          if (p?.position) {
            positions.push(String(p.position));
          }
        }
      }

      return (
        positions.find(p => p === "front") ||
        positions.find(p => p.includes("front")) ||
        positions[0] ||
        "front"
      );
    }

    function isBadProduct(title) {
      const t = String(title || "").toLowerCase();

      return (
        t.includes("kid") ||
        t.includes("kids") ||
        t.includes("youth") ||
        t.includes("baby") ||
        t.includes("toddler") ||
        t.includes("pet") ||
        t.includes("dog")
      );
    }

    if (action === "mockchain_catalog") {
      const blueprints = await loadBlueprints();

      const offset = Math.max(0, Number(body.offset || 0));
      const limit = Math.max(1, Math.min(9, Number(body.limit || 9)));

      const products = [];
      let scanned = 0;
      let nextOffset = offset;

      for (let i = offset; i < blueprints.length; i++) {
        nextOffset = i + 1;

        const bp = blueprints[i];
        const title = String(bp.title || "").toLowerCase();

        if (!title.includes("unisex")) continue;
        if (isBadProduct(title)) continue;

        const images = unique(collectImages(bp));
        const thumbnail = images[0] || null;

        products.push({
          key: String(bp.id),
          label: bp.title || `Printify produkt ${bp.id}`,
          blueprint_id: bp.id,
          blueprint_title: bp.title || `Blueprint ${bp.id}`,
          print_provider_id: null,
          print_provider_title: "Printify",
          thumbnail,
          images,
          variants: [],
          sizes: [],
          colors: []
        });

        scanned++;

        if (scanned >= limit) break;
      }

      return res.status(200).json({
        ok: true,
        products,
        count: products.length,
        nextOffset,
        totalBlueprints: blueprints.length
      });
    }

    if (action === "get_variants") {
      try {
        const blueprintId = body.blueprint_id;

        if (!blueprintId) {
          return res.status(200).json({
            ok: true,
            colors: [],
            sizes: [],
            images: [],
            variants: []
          });
        }

        const providers = await loadProviders(blueprintId);
        const provider = providers?.[0];

        if (!provider?.id) {
          return res.status(200).json({
            ok: true,
            colors: [],
            sizes: [],
            images: [],
            variants: []
          });
        }

        const variantsData = await loadVariants(
          blueprintId,
          provider.id
        );

        const variants = Array.isArray(variantsData.variants)
          ? variantsData.variants
          : [];

        const normalized = variants.map(v => {
          const split = splitVariant(v.title || "");

          return {
            id: v.id,
            title: v.title || `Variant ${v.id}`,
            size: split.size,
            color: split.color,
            is_enabled: v.is_enabled !== false,

            // Cena z API
            price: v.price ?? v.cost ?? v.retail_price ?? null
          };
        });

        const images = unique(collectImages(variantsData));

        return res.status(200).json({
          ok: true,
          blueprint_id: blueprintId,
          print_provider_id: provider.id,
          print_provider_title:
            provider.title ||
            provider.name ||
            `Provider ${provider.id}`,
          colors: unique(normalized.map(v => v.color)),
          sizes: unique(normalized.map(v => v.size)),
          images,
          variants: normalized,
          print_areas: variantsData.print_areas || []
        });
      } catch (e) {
        return res.status(200).json({
          ok: true,
          colors: [],
          sizes: [],
          images: [],
          variants: [],
          error: e.message || String(e)
        });
      }
    }

    if (action === "preview_status") {
      const { product_id } = body;

      if (!product_id) {
        return res.status(400).json({
          ok: false,
          error: "Missing product_id"
        });
      }

      const shopId = await getShopId();

      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/shops/${shopId}/products/${product_id}.json`,
        { headers: authHeader },
        12000
      );

      const product = await safeJson(resp);

      if (!resp.ok || !product?.id) {
        return res.status(500).json({
          ok: false,
          error: "Product fetch failed",
          resp: product
        });
      }

      const preview = extractPreview(product);

      return res.status(200).json({
        ok: true,
        product,
        product_id: product.id,
        preview,
        preview_url: preview,
        images: unique(collectImages(product)),
        mockup_pending: !preview
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

      // hodnoty z prodchain.php
      print_x,
      print_y,
      print_scale,
      print_angle
    } = body;

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    if (!blueprint_id || !print_provider_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing product blueprint or provider"
      });
    }

    const shopId = await getShopId();

    const imageResp = await fetchWithTimeout(
      image_url,
      {},
      10000
    );

    if (!imageResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Image download failed",
        status: imageResp.status,
        image_url
      });
    }

    const imageBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");

    const uploadResp = await fetchWithTimeout(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          file_name: `${crop_id}.jpg`,
          contents: imageBase64
        })
      },
      20000
    );

    const uploadData = await safeJson(uploadResp);

    if (!uploadResp.ok || !uploadData.id) {
      return res.status(500).json({
        ok: false,
        error: "Upload failed",
        resp: uploadData
      });
    }

    const variantsData = await loadVariants(
      blueprint_id,
      print_provider_id
    );

    const variants = Array.isArray(variantsData.variants)
      ? variantsData.variants
      : [];

    const selectedVariant =
      variants.find(v => String(v.id) === String(variant_id)) ||
      variants[0];

    if (!selectedVariant) {
      return res.status(500).json({
        ok: false,
        error: "No variant found",
        resp: variantsData
      });
    }

    const placeholder = frontPlaceholder(
      variantsData.print_areas || []
    );

    /*
      Hodnoty sa ukladajú z prodchain:
      x/y = pozícia dizajnu
      scale = veľkosť
      angle = otočenie
    */
    const finalPrintX = clampNumber(print_x, 0, 1, 0.5);
    const finalPrintY = clampNumber(print_y, 0, 1, 0.5);
    const finalPrintScale = clampNumber(print_scale, 0.15, 2, 1);
    const finalPrintAngle = clampNumber(print_angle, -30, 30, 0);

    const productPayload = {
      title: `CHAINVERS ${product_type || "Printify produkt"} ${crop_id}`,

      description:
        `CHAINVERS produkt\n\n` +
        `Typ produktu: ${product_type || ""}\n` +
        `Veľkosť: ${size || ""}\n` +
        `Farba: ${color || ""}`,

      blueprint_id: Number(blueprint_id),
      print_provider_id: Number(print_provider_id),

      variants: [
        {
          id: Number(selectedVariant.id),
          price: 2000,
          is_enabled: true
        }
      ],

      print_areas: [
        {
          variant_ids: [Number(selectedVariant.id)],

          placeholders: [
            {
              position: placeholder,

              images: [
                {
                  id: uploadData.id,

                  // presné nastavenie z PRODCHAIN
                  x: finalPrintX,
                  y: finalPrintY,
                  scale: finalPrintScale,
                  angle: finalPrintAngle
                }
              ]
            }
          ]
        }
      ],

      external_id: `chainvers_${crop_id}_${Date.now()}`
    };

    const createResp = await fetchWithTimeout(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(productPayload)
      },
      22000
    );

    const product = await safeJson(createResp);

    if (!createResp.ok || !product.id) {
      return res.status(500).json({
        ok: false,
        error: "Product creation failed",
        resp: product
      });
    }

    const preview = extractPreview(product);

    return res.status(200).json({
      ok: true,
      product,
      product_id: product.id,
      preview,
      preview_url: preview,
      images: unique(collectImages(product)),
      printify_product_id: product.id,
      printify_status: "product_created",

      selected: {
        blueprint_id,
        print_provider_id,
        variant_id: selectedVariant.id,
        variant_title: selectedVariant.title || null,
        placeholder,

        print_x: finalPrintX,
        print_y: finalPrintY,
        print_scale: finalPrintScale,
        print_angle: finalPrintAngle
      }
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}