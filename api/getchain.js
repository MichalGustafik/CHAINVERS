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

  const authHeader = {
    Authorization: `Bearer ${PRINTIFY_API_KEY}`,
    "Content-Type": "application/json"
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
      10000
    );

    const shops = await safeJson(shopsResp);
    const shopId = shops?.[0]?.id;

    if (!shopId) {
      throw new Error("No Printify shop found");
    }

    return shopId;
  }

  async function uploadImageFromUrl(imageUrl, cropId) {
    const imageResp = await fetchWithTimeout(imageUrl, {}, 12000);

    if (!imageResp.ok) {
      throw new Error(`Image download failed: ${imageResp.status}`);
    }

    const imageBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");

    const uploadResp = await fetchWithTimeout(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({
          file_name: `${cropId || "chainvers"}.jpg`,
          contents: imageBase64
        })
      },
      20000
    );

    const uploadData = await safeJson(uploadResp);

    if (!uploadResp.ok || !uploadData.id) {
      throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);
    }

    return uploadData;
  }

  function chooseVariant(variants, settings = {}) {
    if (!Array.isArray(variants) || !variants.length) return null;

    const size = String(settings.size || "").toLowerCase();
    const color = String(settings.color || "").toLowerCase();

    let enabled = variants.filter(v => v.is_enabled !== false);
    if (!enabled.length) enabled = variants;

    let exact = enabled.find(v => {
      const title = String(v.title || "").toLowerCase();
      return (!size || title.includes(size)) && (!color || title.includes(color));
    });

    return exact || enabled[0];
  }

  function getFrontPlaceholder(printAreas) {
    if (!Array.isArray(printAreas)) return "front";

    const positions = [];

    for (const area of printAreas) {
      if (Array.isArray(area.placeholders)) {
        for (const p of area.placeholders) {
          if (p?.position) positions.push(p.position);
        }
      }
    }

    return (
      positions.find(p => p === "front") ||
      positions.find(p => String(p).includes("front")) ||
      positions[0] ||
      "front"
    );
  }

  try {
    const body = req.body || {};
    const action = body.action || "create_product";

    if (action === "catalog") {
      const blueprintsResp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        15000
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
        return res.status(400).json({ ok: false, error: "Missing blueprint_id" });
      }

      const providersResp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprint_id}/print_providers.json`,
        { headers: authHeader },
        15000
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
        15000
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

    if (action === "create_product" || action === "mockup") {
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

      const shopId = await getShopId();

      let finalBlueprintId = blueprint_id || 9;

      const providersResp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${finalBlueprintId}/print_providers.json`,
        { headers: authHeader },
        15000
      );

      const providers = await safeJson(providersResp);
      const finalProviderId = print_provider_id || providers?.[0]?.id;

      if (!finalProviderId) {
        return res.status(500).json({
          ok: false,
          error: "No provider found",
          resp: providers
        });
      }

      const variantsResp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${finalBlueprintId}/print_providers/${finalProviderId}/variants.json`,
        { headers: authHeader },
        15000
      );

      const variantsData = await safeJson(variantsResp);

      if (!variantsResp.ok) {
        return res.status(500).json({
          ok: false,
          error: "Variants failed",
          resp: variantsData
        });
      }

      const variants = variantsData.variants || [];
      const selectedVariant =
        variants.find(v => String(v.id) === String(variant_id)) ||
        chooseVariant(variants, { size, color });

      if (!selectedVariant) {
        return res.status(500).json({
          ok: false,
          error: "No variant found",
          resp: variantsData
        });
      }

      const finalVariantId = selectedVariant.id;
      const uploadData = await uploadImageFromUrl(image_url, crop_id);

      const placeholderPosition =
        placement === "back"
          ? "back"
          : getFrontPlaceholder(variantsData.print_areas);

      const externalId = `chainvers_${crop_id}_${finalBlueprintId}_${finalProviderId}_${finalVariantId}_${Date.now()}`;

      const productPayload = {
        title: `CHAINVERS ${product_type || selectedVariant.title || "Product"} ${crop_id}`,
        description:
          `CHAINVERS custom product\n\n` +
          `Crop ID: ${crop_id}\n` +
          `Mode: ${product_mode || ""}\n` +
          `Type: ${product_type || ""}\n` +
          `Size: ${size || ""}\n` +
          `Color: ${color || ""}\n` +
          `Fit: ${fit || ""}\n` +
          `Placement: ${placement || "front"}\n` +
          `Note: ${note || ""}`,
        blueprint_id: Number(finalBlueprintId),
        print_provider_id: Number(finalProviderId),
        variants: [
          {
            id: Number(finalVariantId),
            price: 2000,
            is_enabled: true
          }
        ],
        print_areas: [
          {
            variant_ids: [Number(finalVariantId)],
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
          headers: authHeader,
          body: JSON.stringify(productPayload)
        },
        25000
      );

      const product = await safeJson(createResp);

      if (!createResp.ok || !product.id) {
        return res.status(500).json({
          ok: false,
          error: "Product creation failed",
          resp: product
        });
      }

      let preview = null;

      if (Array.isArray(product.images) && product.images.length) {
        preview =
          product.images[0]?.src ||
          product.images[0]?.url ||
          null;
      }

      if (!preview && Array.isArray(product.mockups) && product.mockups.length) {
        preview =
          product.mockups[0]?.src ||
          product.mockups[0]?.url ||
          null;
      }

      return res.status(200).json({
        ok: true,
        action,
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
          print_provider_id: finalProviderId,
          variant_id: finalVariantId,
          variant_title: selectedVariant.title || null,
          placeholder: placeholderPosition
        },
        warning: preview
          ? null
          : "Product created. Printify mockup may need a few seconds to become available."
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Unknown action"
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}