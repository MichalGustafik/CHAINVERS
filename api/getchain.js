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

    // 1) Shop ID
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

    // Pomocná funkcia: načítaj produkty a nájdi podľa external_id
    async function findExistingProduct() {
      const prodsResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products.json`,
        { headers: authHeader }
      );

      const productsResp = await prodsResp.json();
      const products = Array.isArray(productsResp.data) ? productsResp.data : [];

      return products.find((p) => p.external_id === externalId) || null;
    }

    // Pomocná funkcia: detail produktu
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

    // 2) Najprv skús existujúci produkt
    let existing = await findExistingProduct();

    if (existing) {
      const detail = await loadProductDetail(existing.id);

      if (!detail.ok) {
        return res.status(500).json({
          ok: false,
          error: "Existing product detail load failed",
          resp: detail.resp
        });
      }

      const product = detail.product;
      const mockup = product?.images?.[0]?.src || null;

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

    // 3) Recovery mód: order existuje, ale musíme nájsť produkt/mockup
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

      if (!detail.ok) {
        return res.status(500).json({
          ok: false,
          error: "Recover product detail failed.",
          resp: detail.resp
        });
      }

      const recoverProduct = detail.product;
      const mockup = recoverProduct?.images?.[0]?.src || null;

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

    // 4) Stiahni obrázok a premeň na base64
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

    // 5) Upload obrázka do Printify
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

    // 6) Blueprint / provider / variant
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

    // 7) Create product
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

    // 8) Publish product
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

    // 9) Detail produktu kvôli mockup obrázkom
    const detail = await loadProductDetail(product.id);

    if (detail.ok) {
      product = detail.product;
    }

    const mockup = product?.images?.[0]?.src || null;

    // 10) Create order
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