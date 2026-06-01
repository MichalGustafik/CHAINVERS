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
    const { crop_id, image_url, shipping } = req.body || {};

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    const authHeader = {
      Authorization: `Bearer ${PRINTIFY_API_KEY}`
    };

    const externalId = `chainvers_${crop_id}`;

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

    const shopsResp = await fetchWithTimeout(
      "https://api.printify.com/v1/shops.json",
      { headers: authHeader },
      8000
    );

    const shops = await safeJson(shopsResp);
    const shopId = shops?.[0]?.id;

    if (!shopId) {
      return res.status(500).json({
        ok: false,
        error: "No shop found",
        resp: shops
      });
    }

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

    const blueprintId = 9;

    const providersResp = await fetchWithTimeout(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
      { headers: authHeader },
      8000
    );

    const providers = await safeJson(providersResp);
    const providerId = providers?.[0]?.id;

    if (!providerId) {
      return res.status(500).json({
        ok: false,
        error: "No provider found",
        resp: providers
      });
    }

    const variantsResp = await fetchWithTimeout(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
      { headers: authHeader },
      8000
    );

    const variantsData = await safeJson(variantsResp);
    const variant = Array.isArray(variantsData.variants)
      ? variantsData.variants[0]
      : null;

    if (!variant) {
      return res.status(500).json({
        ok: false,
        error: "No variant found",
        resp: variantsData
      });
    }

    const variantId = variant.id;

    const productPayload = {
      title: `CHAINVERS Tee ${crop_id}`,
      description: `Unikátne tričko s panelom ${crop_id}`,
      blueprint_id: blueprintId,
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
              position: "front",
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

    return res.status(200).json({
      ok: true,
      exists: false,
      duplicate: false,
      order_pending: true,
      mockup_pending: true,
      product,
      order: null,
      preview: null,
      preview_url: null,
      printify_order_id: null,
      printify_status: "product_created",
      tracking_number: null,
      tracking_url: null,
      tracking_carrier: null,
      tracking_status: "pending",
      shipping_received: !!shipping,
      warning: "Product created. Mockup/order will be available later."
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}