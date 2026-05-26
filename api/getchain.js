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

    const shopsResp = await fetch("https://api.printify.com/v1/shops.json", {
      headers: authHeader
    });

    const shops = await shopsResp.json();
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

      const productsResp = await prodsResp.json();
      const products = Array.isArray(productsResp.data) ? productsResp.data : [];

      return products.find((p) => p.external_id === externalId) || null;
    }

    async function loadProductDetail(productId) {
      const detailResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products/${productId}.json`,
        { headers: authHeader }
      );

      const product = await detailResp.json();

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

    async function waitForMockup(productId, tries = 10) {
      let lastProduct = null;

      for (let i = 0; i < tries; i++) {
        const detail = await loadProductDetail(productId);

        if (detail.ok) {
          lastProduct = detail.product;

          const mockup =
            detail.product?.images?.[0]?.src ||
            detail.product?.images?.[0]?.url ||
            null;

          if (mockup) {
            return {
              ok: true,
              product: detail.product,
              mockup
            };
          }
        } else {
          lastProduct = detail.resp || null;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      return {
        ok: false,
        product: lastProduct,
        mockup: null
      };
    }

    let existing = await findExistingProduct();

    if (existing) {
      const mockupWait = await waitForMockup(existing.id, 10);

      const product = mockupWait.product;
      const mockup = mockupWait.mockup;

      if (!mockup) {
        return res.status(500).json({
          ok: false,
          error: "Existing Printify product found, but mockup image is not ready yet.",
          product_id: existing.id,
          product
        });
      }

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: !!recover,
        product,
        order: existing_order || null,
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

      const mockupWait = await waitForMockup(recoverExisting.id, 10);

      const recoverProduct = mockupWait.product;
      const mockup = mockupWait.mockup;

      if (!mockup) {
        return res.status(500).json({
          ok: false,
          error: "Recover product found, but mockup image is not ready yet.",
          product_id: recoverExisting.id,
          product: recoverProduct
        });
      }

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: true,
        order: existing_order,
        product: recoverProduct,
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

    const uploadData = await uploadResp.json();

    if (!uploadData.id) {
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

    const providers = await providersResp.json();
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

    const variantsData = await variantsResp.json();
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

    const created = await createProdResp.json();

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

    const mockupWait = await waitForMockup(product.id, 10);

    if (mockupWait.product?.id) {
      product = mockupWait.product;
    }

    const mockup = mockupWait.mockup;

    if (!mockup) {
      return res.status(500).json({
        ok: false,
        error: "Printify product was created, but mockup image is not ready yet.",
        product_id: product?.id || null,
        product
      });
    }

    const orderPayload = {
      external_id: externalId,
      line_items: [
        {
          product_id: product.id,
          variant_id: variantId,
          quantity: 1
        }
      ],
      address_to: {
        first_name: "CHAIN",
        last_name: "User",
        email: "test@example.com",
        phone: "421900000000",
        country: "SK",
        address1: "Test Street 1",
        city: "Bratislava",
        zip: "81101"
      }
    };

    const orderResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/orders.json`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload)
      }
    );

    const order = await orderResp.json();

    if (!orderResp.ok) {
      const code = Number(order?.code || order?.errors?.code || 0);
      const reason = String(order?.errors?.reason || order?.message || "");

      const duplicateOrder =
        code === 8503 ||
        code === 8100 ||
        reason.toLowerCase().includes("already exists");

      if (duplicateOrder) {
        return res.status(200).json({
          ok: true,
          exists: true,
          duplicate: true,
          order: order?.order || null,
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

    return res.status(200).json({
      ok: true,
      exists: false,
      duplicate: false,
      product,
      order,
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