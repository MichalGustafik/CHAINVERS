// FILE: /api/getchain.js

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
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

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
      message: "CHAINVERS getchain endpoint is running",
      version: "chainvers-printify-universal-catalog-v1"
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

    const action =
      body.action ||
      ((!body.crop_id && !body.image_url) ? "mockchain_catalog" : "create_product");

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
        throw new Error(`Timeout/fetch failed: ${url} :: ${e.message}`);
      }
    }

    async function getShopId() {
      const shopsResp = await fetchWithTimeout(
        "https://api.printify.com/v1/shops.json",
        { headers: authHeader },
        9000
      );

      const shops = await safeJson(shopsResp);
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

      if (bp?.image) return bp.image;
      if (bp?.thumbnail) return bp.thumbnail;
      if (bp?.display_image) return bp.display_image;

      return null;
    }

    function uniqueClean(arr) {
      return [
        ...new Set(
          (arr || [])
            .map(v => String(v || "").trim())
            .filter(Boolean)
        )
      ];
    }

    function splitVariantTitle(title = "") {
      const parts = String(title)
        .split(/[\/|,]/g)
        .map(v => v.trim())
        .filter(Boolean);

      let size = "";
      let color = "";

      const sizeRe =
        /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|7XL|8XL|9XL|10XL|One size|11oz|12oz|15oz|16x24|18x24|24x36)$/i;

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

      if (!size && parts.length) size = parts[parts.length - 1];
      if (!color && parts.length > 1) color = parts[0];

      return {
        size: size || "Default",
        color: color || "Default"
      };
    }

    function isBadBlueprint(bp) {
      const t = String(bp.title || "").toLowerCase();

      return (
        t.includes("kid") ||
        t.includes("kids") ||
        t.includes("youth") ||
        t.includes("baby") ||
        t.includes("toddler") ||
        t.includes("pet") ||
        t.includes("dog") ||
        t.includes("zip") ||
        t.includes("zipper") ||
        t.includes("full zip") ||
        t.includes("full-zip") ||
        t.includes("hoodie") ||
        t.includes("hooded") ||
        t.includes("sweatshirt")
      );
    }

    function isAllowedProduct(bp) {
      const t = String(bp.title || "").toLowerCase();

      if (isBadBlueprint(bp)) {
        return false;
      }

      return (
        t.includes("t-shirt") ||
        t.includes("shirt") ||
        t.includes("tee") ||
        t.includes("tank") ||
        t.includes("top") ||
        t.includes("long sleeve") ||
        t.includes("sleeveless")
      );
    }

    function placementToPosition(placement, printAreas = []) {
      const wanted = String(placement || "front_center").toLowerCase();
      const positions = [];

      for (const area of printAreas || []) {
        for (const p of area?.placeholders || []) {
          if (p?.position) {
            positions.push(String(p.position));
          }
        }
      }

      if (wanted.includes("back")) {
        return (
          positions.find(p => p === "back") ||
          positions.find(p => p.includes("back")) ||
          "back"
        );
      }

      return (
        positions.find(p => p === "front") ||
        positions.find(p => p.includes("front")) ||
        positions[0] ||
        "front"
      );
    }

    async function loadBlueprints() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        15000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error(`Catalog blueprints failed: ${JSON.stringify(data)}`);
      }

      return Array.isArray(data) ? data : [];
    }

    async function loadProviders(blueprintId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers: authHeader },
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
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error(`Variants failed: ${JSON.stringify(data)}`);
      }

      return data || {};
    }

    async function normalizeProduct(blueprint) {
      const providers = await loadProviders(blueprint.id);
      const provider = providers?.[0];

      if (!provider?.id) {
        return null;
      }

      const variantsData = await loadVariants(blueprint.id, provider.id);

      const variants = Array.isArray(variantsData.variants)
        ? variantsData.variants
        : [];

      if (!variants.length) {
        return null;
      }

      const normalizedVariants = variants.slice(0, 300).map(v => {
        const sp = splitVariantTitle(v.title || "");

        return {
          id: v.id,
          title: v.title || `Variant ${v.id}`,
          size: sp.size,
          color: sp.color,
          is_enabled: v.is_enabled !== false
        };
      });

      return {
        key: `${blueprint.id}_${provider.id}`,
        label: blueprint.title || `Printify produkt ${blueprint.id}`,
        blueprint_id: blueprint.id,
        blueprint_title: blueprint.title || `Blueprint ${blueprint.id}`,
        print_provider_id: provider.id,
        print_provider_title:
          provider.title ||
          provider.name ||
          `Provider ${provider.id}`,
        thumbnail: extractBlueprintThumb(blueprint),
        variants: normalizedVariants,
        sizes: uniqueClean(normalizedVariants.map(v => v.size)),
        colors: uniqueClean(normalizedVariants.map(v => v.color)),
        print_areas: variantsData.print_areas || []
      };
    }

    if (action === "ping") {
      return res.status(200).json({
        ok: true,
        cors: true,
        timestamp: Date.now(),
        version: "chainvers-printify-universal-catalog-v1"
      });
    }

    if (action === "catalog") {
      const blueprints = await loadBlueprints();

      return res.status(200).json({
        ok: true,
        blueprints
      });
    }

    if (action === "providers") {
      const { blueprint_id } = body;

      if (!blueprint_id) {
        return res.status(400).json({
          ok: false,
          error: "Missing blueprint_id"
        });
      }

      const providers = await loadProviders(blueprint_id);

      return res.status(200).json({
        ok: true,
        providers
      });
    }

    if (action === "variants") {
      const { blueprint_id, print_provider_id } = body;

      if (!blueprint_id || !print_provider_id) {
        return res.status(400).json({
          ok: false,
          error: "Missing blueprint_id or print_provider_id"
        });
      }

      const variantsData = await loadVariants(blueprint_id, print_provider_id);

      return res.status(200).json({
        ok: true,
        variants: variantsData.variants || [],
        print_areas: variantsData.print_areas || []
      });
    }

    if (action === "mockchain_catalog") {
      const blueprints = await loadBlueprints();

      const wanted = blueprints
        .filter(bp => isAllowedProduct(bp))
        .slice(0, 24);

      const products = [];

      for (const bp of wanted) {
        try {
          const product = await normalizeProduct(bp);

          if (product) {
            products.push(product);
          }
        } catch (e) {
          continue;
        }
      }

      return res.status(200).json({
        ok: true,
        products,
        count: products.length
      });
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

      const productResp = await fetchWithTimeout(
        `https://api.printify.com/v1/shops/${shopId}/products/${product_id}.json`,
        { headers: authHeader },
        12000
      );

      const product = await safeJson(productResp);

      if (!productResp.ok || !product?.id) {
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
        mockup_pending: !preview,
        printify_status: preview ? "mockup_ready" : "mockup_pending"
      });
    }

    const {
      crop_id,
      image_url,
      shipping,
      blueprint_id,
      print_provider_id,
      variant_id,
      product_type,
      variant_size,
      variant_color,
      size,
      color,
      customer_note,
      note
    } = body;

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    const externalId = `chainvers_${crop_id}_${Date.now()}`;
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

    const finalBlueprintId = Number(blueprint_id || 9);

    const providers = await loadProviders(finalBlueprintId);
    const providerId = Number(print_provider_id || providers?.[0]?.id);

    if (!providerId) {
      return res.status(500).json({
        ok: false,
        error: "No provider found",
        resp: providers
      });
    }

    const variantsData = await loadVariants(finalBlueprintId, providerId);

    const variants = Array.isArray(variantsData.variants)
      ? variantsData.variants
      : [];

    let variant = null;

    if (variant_id) {
      variant = variants.find(v => String(v.id) === String(variant_id));
    }

    const wantedSize = String(size || variant_size || "").toLowerCase();
    const wantedColor = String(color || variant_color || "").toLowerCase();

    if (!variant && (wantedSize || wantedColor)) {
      variant = variants.find(v => {
        const title = String(v.title || "").toLowerCase();

        return (
          (!wantedSize || title.includes(wantedSize)) &&
          (!wantedColor || title.includes(wantedColor))
        );
      });
    }

    if (!variant) {
      variant = variants[0] || null;
    }

    if (!variant) {
      return res.status(500).json({
        ok: false,
        error: "No variant found",
        resp: variantsData
      });
    }

    const variantId = Number(variant.id);
    const placeholderPosition = placementToPosition(
      "front",
      variantsData.print_areas || []
    );

    const selectedType =
      product_type ||
      body.blueprint_title ||
      "CHAINVERS Printify produkt";

    const selectedSize = size || variant_size || "";
    const selectedColor = color || variant_color || "";
    const selectedNote = note || customer_note || "";

    const productPayload = {
      title: `CHAINVERS ${selectedType} ${crop_id}`,
      description:
        `Unikátny CHAINVERS produkt s panelom ${crop_id}\n\n` +
        `Printify produkt: ${selectedType}\n` +
        `Veľkosť: ${selectedSize}\n` +
        `Farba: ${selectedColor}\n` +
        `Umiestnenie: Predok stred\n` +
        `Poznámka: ${selectedNote}`,
      blueprint_id: finalBlueprintId,
      print_provider_id: providerId,
      variants: [
        {
          id: variantId,
          price: 2000,
          is_enabled: true
        }
      ],
      print_areas: [
        {
          variant_ids: [variantId],
          placeholders: [
            {
              position: placeholderPosition,
              images: [
                {
                  id: uploadData.id,
                  x: 0.5,
                  y: 0.5,
                  scale: 1,
                  angle: 0
                }
              ]
            }
          ]
        }
      ],
      external_id: externalId
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
      printify_product_id: product.id,
      printify_status: "product_created",
      shipping_received: !!shipping,
      selected: {
        blueprint_id: finalBlueprintId,
        print_provider_id: providerId,
        variant_id: variantId,
        variant_title: variant.title || null,
        placeholder: placeholderPosition
      },
      warning: preview
        ? null
        : "Product created. Mockup may need a few seconds to become available."
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}