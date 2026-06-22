// FILE: /api/getchain.js

export const maxDuration = 60;

export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing PRINTIFY_API_KEY" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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

    async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
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
        8000
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

    if (action === "ping") {
      return res.status(200).json({
        ok: true,
        version: "chainvers-getchain-catalog-v2"
      });
    }

    if (action === "catalog") {
      const blueprintsResp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        12000
      );

      const blueprints = await safeJson(blueprintsResp);

      if (!blueprintsResp.ok) {
        return res.status(500).json({
          ok: false,
          error: "Catalog blueprints failed",
          resp: blueprints
        });
      }

      return res.status(200).json({
        ok: true,
        blueprints: Array.isArray(blueprints) ? blueprints : []
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

      const providersResp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprint_id}/print_providers.json`,
        { headers: authHeader },
        12000
      );

      const providers = await safeJson(providersResp);

      if (!providersResp.ok) {
        return res.status(500).json({
          ok: false,
          error: "Providers failed",
          resp: providers
        });
      }

      return res.status(200).json({
        ok: true,
        providers: Array.isArray(providers) ? providers : []
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

      const variantsResp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprint_id}/print_providers/${print_provider_id}/variants.json`,
        { headers: authHeader },
        12000
      );

      const variantsData = await safeJson(variantsResp);

      if (!variantsResp.ok) {
        return res.status(500).json({
          ok: false,
          error: "Variants failed",
          resp: variantsData
        });
      }

      return res.status(200).json({
        ok: true,
        variants: variantsData.variants || [],
        print_areas: variantsData.print_areas || []
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
      product_mode,
      product_type,
      size,
      color,
      fit,
      placement,
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
      8000
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
      15000
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

    const providersResp = await fetchWithTimeout(
      `https://api.printify.com/v1/catalog/blueprints/${finalBlueprintId}/print_providers.json`,
      { headers: authHeader },
      8000
    );

    const providers = await safeJson(providersResp);
    const providerId = Number(print_provider_id || providers?.[0]?.id);

    if (!providerId) {
      return res.status(500).json({
        ok: false,
        error: "No provider found",
        resp: providers
      });
    }

    const variantsResp = await fetchWithTimeout(
      `https://api.printify.com/v1/catalog/blueprints/${finalBlueprintId}/print_providers/${providerId}/variants.json`,
      { headers: authHeader },
      8000
    );

    const variantsData = await safeJson(variantsResp);
    const variants = Array.isArray(variantsData.variants)
      ? variantsData.variants
      : [];

    let variant = null;

    if (variant_id) {
      variant = variants.find(v => String(v.id) === String(variant_id));
    }

    if (!variant && (size || color)) {
      const s = String(size || "").toLowerCase();
      const c = String(color || "").toLowerCase();

      variant = variants.find(v => {
        const title = String(v.title || "").toLowerCase();
        return (!s || title.includes(s)) && (!c || title.includes(c));
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

    let placeholderPosition = "front";

    if (placement === "back") {
      placeholderPosition = "back";
    } else if (Array.isArray(variantsData.print_areas)) {
      const foundPositions = [];

      for (const area of variantsData.print_areas) {
        if (Array.isArray(area.placeholders)) {
          for (const placeholder of area.placeholders) {
            if (placeholder?.position) {
              foundPositions.push(placeholder.position);
            }
          }
        }
      }

      placeholderPosition =
        foundPositions.find(p => p === "front") ||
        foundPositions.find(p => String(p).includes("front")) ||
        foundPositions[0] ||
        "front";
    }

    const productPayload = {
      title: `CHAINVERS ${product_type || "Product"} ${crop_id}`,
      description:
        `Unikátny CHAINVERS produkt s panelom ${crop_id}\n\n` +
        `Mode: ${product_mode || ""}\n` +
        `Typ produktu: ${product_type || ""}\n` +
        `Veľkosť: ${size || ""}\n` +
        `Farba: ${color || ""}\n` +
        `Fit: ${fit || ""}\n` +
        `Umiestnenie: ${placement || "front"}\n` +
        `Poznámka: ${note || ""}`,
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
      15000
    );

    const product = await safeJson(createResp);

    if (!createResp.ok || !product.id) {
      const rawText = JSON.stringify(product);
      const duplicate =
        rawText.toLowerCase().includes("already exists") ||
        rawText.includes("8100") ||
        rawText.includes("8503");

      if (duplicate) {
        return res.status(200).json({
          ok: true,
          exists: true,
          duplicate: true,
          mockup_pending: true,
          product: null,
          order: null,
          preview: null,
          preview_url: null,
          printify_status: "product_exists",
          tracking_status: "pending",
          resp: product
        });
      }

      return res.status(500).json({
        ok: false,
        error: "Product creation failed",
        resp: product
      });
    }

    const preview = extractPreview(product);

    return res.status(200).json({
      ok: true,
      exists: false,
      duplicate: false,
      order_pending: true,
      mockup_pending: !preview,
      product,
      order: null,
      preview,
      preview_url: preview,
      printify_product_id: product.id,
      printify_order_id: null,
      printify_status: "product_created",
      tracking_number: null,
      tracking_url: null,
      tracking_carrier: null,
      tracking_status: "pending",
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
        : "Product created. Mockup/order will be available later."
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}