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
    const { crop_id, image_url, recover, existing_order, shipping } = req.body || {};

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };
    const externalId = `chainvers_${crop_id}`;

    function normalizeShipping(s = {}) {
      const name = String(s.name || "CHAIN User").trim();
      const parts = name.split(" ").filter(Boolean);

      return {
        first_name: parts.shift() || "CHAIN",
        last_name: parts.join(" ") || "User",
        email: String(s.email || "test@example.com").trim(),
        phone: String(s.phone || "421900000000").trim(),
        country: String(s.country || "SK").trim().toUpperCase(),
        address1: String(s.address1 || "Test Street 1").trim(),
        address2: String(s.address2 || "").trim(),
        city: String(s.city || "Bratislava").trim(),
        zip: String(s.zip || "81101").trim()
      };
    }

    function extractTracking(order = null) {
      const s = order?.shipments?.[0] || {};

      return {
        printify_order_id: order?.id || order?.order_id || null,
        printify_status: order?.status || "pending",
        tracking_number: s?.tracking_number || s?.number || null,
        tracking_url: s?.tracking_url || s?.url || null,
        tracking_carrier: s?.carrier || null,
        tracking_status: s?.status || order?.status || "pending"
      };
    }

    function mockupPendingTracking(status = "mockup_pending") {
      return {
        printify_order_id: null,
        printify_status: status,
        tracking_number: null,
        tracking_url: null,
        tracking_carrier: null,
        tracking_status: "pending"
      };
    }

    async function safeJson(resp) {
      const text = await resp.text();

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    const shopsResp = await fetch("https://api.printify.com/v1/shops.json", {
      headers: authHeader
    });

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
      const prodsResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products.json`,
        { headers: authHeader }
      );

      const productsResp = await safeJson(prodsResp);
      const products = Array.isArray(productsResp.data) ? productsResp.data : [];

      return products.find((p) => p.external_id === externalId) || null;
    }

    async function loadProductDetail(productId) {
      const detailResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products/${productId}.json`,
        { headers: authHeader }
      );

      const product = await safeJson(detailResp);

      if (!detailResp.ok || !product?.id) {
        return {
          ok: false,
          error: "Product detail load failed",
          resp: product
        };
      }

      return {
        ok: true,
        product
      };
    }

    function getMockup(product) {
      return (
        product?.images?.[0]?.src ||
        product?.images?.[0]?.url ||
        null
      );
    }

    let existing = await findExistingProduct();

    if (existing) {
      const detail = await loadProductDetail(existing.id);
      const product = detail.ok ? detail.product : existing;
      const mockup = getMockup(product);

      const tracking = extractTracking(existing_order || null);

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: !!recover,
        mockup_pending: !mockup,
        product,
        order: existing_order || null,
        tracking,
        printify_order_id: tracking.printify_order_id,
        printify_status: tracking.printify_status,
        tracking_number: tracking.tracking_number,
        tracking_url: tracking.tracking_url,
        tracking_carrier: tracking.tracking_carrier,
        tracking_status: tracking.tracking_status,
        preview: mockup,
        preview_url: mockup
      });
    }

    if (recover === true && existing_order?.id) {
      const recoverExisting = await findExistingProduct();

      if (!recoverExisting) {
        return res.status(500).json({
          ok: false,
          error: "Printify order exists, but matching product with external_id was not found. Cannot recover product mockup.",
          external_id: externalId,
          order: existing_order
        });
      }

      const detail = await loadProductDetail(recoverExisting.id);
      const product = detail.ok ? detail.product : recoverExisting;
      const mockup = getMockup(product);
      const tracking = extractTracking(existing_order);

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: true,
        mockup_pending: !mockup,
        order: existing_order,
        tracking,
        printify_order_id: tracking.printify_order_id,
        printify_status: tracking.printify_status,
        tracking_number: tracking.tracking_number,
        tracking_url: tracking.tracking_url,
        tracking_carrier: tracking.tracking_carrier,
        tracking_status: tracking.tracking_status,
        product,
        preview: mockup,
        preview_url: mockup
      });
    }

    const imageResp = await fetch(image_url);

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

    const uploadResp = await fetch(
      `https://api.printify.com/v1/uploads/images.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: `${crop_id}.png`,
          contents: imageBase64
        })
      }
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

    const providersResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
      { headers: authHeader }
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

    const variantsResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
      { headers: authHeader }
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

    const createProdResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(productPayload)
      }
    );

    const created = await safeJson(createProdResp);

    if (!createProdResp.ok || !created.id) {
      return res.status(500).json({
        ok: false,
        error: "Product creation failed",
        resp: created
      });
    }

    let product = created;

    await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products/${product.id}/publish.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: true,
          description: true,
          images: true,
          variants: true,
          tags: true
        })
      }
    );

    const detail = await loadProductDetail(product.id);
    if (detail.ok) product = detail.product;

    const mockup = getMockup(product);

    const orderPayload = {
      external_id: externalId,
      line_items: [
        {
          product_id: product.id,
          variant_id: variantId,
          quantity: 1
        }
      ],
      address_to: normalizeShipping(shipping)
    };

    const orderResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/orders.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload)
      }
    );

    const order = await safeJson(orderResp);

    if (!orderResp.ok) {
      const code = Number(order?.code || order?.errors?.code || 0);
      const reason = String(order?.errors?.reason || order?.message || "");

      const duplicateOrder =
        code === 8503 ||
        code === 8100 ||
        reason.toLowerCase().includes("already exists");

      if (duplicateOrder) {
        const existingOrder = order?.order || order || null;
        const tracking = extractTracking(existingOrder);

        return res.status(200).json({
          ok: true,
          exists: true,
          duplicate: true,
          mockup_pending: !mockup,
          order: existingOrder,
          tracking,
          printify_order_id: tracking.printify_order_id,
          printify_status: tracking.printify_status,
          tracking_number: tracking.tracking_number,
          tracking_url: tracking.tracking_url,
          tracking_carrier: tracking.tracking_carrier,
          tracking_status: tracking.tracking_status,
          product,
          preview: mockup,
          preview_url: mockup,
          resp: order
        });
      }

      return res.status(500).json({
        ok: false,
        error: "Order creation failed",
        resp: order
      });
    }

    const tracking = extractTracking(order);

    return res.status(200).json({
      ok: true,
      exists: false,
      duplicate: false,
      mockup_pending: !mockup,
      product,
      order,
      tracking,
      printify_order_id: tracking.printify_order_id,
      printify_status: tracking.printify_status,
      tracking_number: tracking.tracking_number,
      tracking_url: tracking.tracking_url,
      tracking_carrier: tracking.tracking_carrier,
      tracking_status: tracking.tracking_status,
      preview: mockup,
      preview_url: mockup
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}