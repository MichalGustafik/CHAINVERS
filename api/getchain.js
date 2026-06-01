// api/getchain.js
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
    const { crop_id, image_url, recover, existing_order } = req.body || {};

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };
    const externalId = `chainvers_${crop_id}`;

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
        throw e;
      }
    }

    function getMockup(product) {
      return (
        product?.images?.[0]?.src ||
        product?.images?.[0]?.url ||
        product?.mockups?.[0]?.src ||
        product?.mockups?.[0]?.url ||
        null
      );
    }

    function pendingTracking(status = "mockup_pending") {
      return {
        printify_order_id: null,
        printify_status: status,
        tracking_number: null,
        tracking_url: null,
        tracking_carrier: null,
        tracking_status: "pending"
      };
    }

    const shopsResp = await fetchWithTimeout("https://api.printify.com/v1/shops.json", {
      headers: authHeader
    }, 10000);

    const shops = await safeJson(shopsResp);
    const shopId = shops[0]?.id;

    if (!shopId) {
      return res.status(500).json({
        ok: false,
        error: "No shop found",
        resp: shops
      });
    }

    async function findExistingProduct() {
      const prodsResp = await fetchWithTimeout(
        `https://api.printify.com/v1/shops/${shopId}/products.json`,
        { headers: authHeader },
        10000
      );

      const productsResp = await safeJson(prodsResp);
      const products = Array.isArray(productsResp.data) ? productsResp.data : [];

      return products.find((p) => p.external_id === externalId) || null;
    }

    async function loadProductDetail(productId) {
      try {
        const detailResp = await fetchWithTimeout(
          `https://api.printify.com/v1/shops/${shopId}/products/${productId}.json`,
          { headers: authHeader },
          10000
        );

        const product = await safeJson(detailResp);

        if (!detailResp.ok || !product?.id) {
          return { ok: false, product: null };
        }

        return { ok: true, product };
      } catch {
        return { ok: false, product: null };
      }
    }

    const existing = await findExistingProduct();

    if (existing) {
      const detail = await loadProductDetail(existing.id);
      const product = detail.ok ? detail.product : existing;
      const mockup = getMockup(product);
      const tracking = pendingTracking(mockup ? "product_exists" : "mockup_pending");

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: !!recover,
        mockup_pending: !mockup,
        product,
        order: existing_order || null,
        tracking,
        printify_order_id: null,
        printify_status: tracking.printify_status,
        tracking_number: null,
        tracking_url: null,
        tracking_carrier: null,
        tracking_status: "pending",
        preview: mockup,
        preview_url: mockup
      });
    }

    const imageResp = await fetchWithTimeout(image_url, {}, 12000);

    if (!imageResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Image download failed",
        resp: {
          status: imageResp.status,
          statusText: imageResp.statusText,
          image_url
        }
      });
    }

    const imageArrayBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageArrayBuffer).toString("base64");

    const uploadResp = await fetchWithTimeout(
      `https://api.printify.com/v1/uploads/images.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: `${crop_id}.jpg`,
          contents: imageBase64
        })
      },
      18000
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
      10000
    );

    const providers = await safeJson(providersResp);
    const providerId = providers[0]?.id;

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
      10000
    );

    const variantsData = await safeJson(variantsResp);
    const variants = Array.isArray(variantsData.variants) ? variantsData.variants : [];
    const variant = variants[0];

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

    const createProdResp = await fetchWithTimeout(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(productPayload)
      },
      18000
    );

    const product = await safeJson(createProdResp);

    if (!createProdResp.ok || !product.id) {
      return res.status(500).json({
        ok: false,
        error: "Product creation failed",
        resp: product
      });
    }

    const tracking = pendingTracking("product_created");

    return res.status(200).json({
      ok: true,
      exists: false,
      duplicate: false,
      order_pending: true,
      mockup_pending: true,
      product,
      order: null,
      tracking,
      printify_order_id: null,
      printify_status: "product_created",
      tracking_number: null,
      tracking_url: null,
      tracking_carrier: null,
      tracking_status: "pending",
      preview: null,
      preview_url: null,
      warning: "Product was created. Mockup/order can be loaded later."
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}