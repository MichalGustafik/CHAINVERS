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
      return res.status(500).json({ ok: false, error: "No shop found", resp: shops });
    }

    const prodsResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      { headers: authHeader }
    );

    const productsResp = await prodsResp.json();
    const products = Array.isArray(productsResp.data) ? productsResp.data : [];

    let existing = products.find((p) => p.external_id === externalId);

    if (existing) {
      const detailResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products/${existing.id}.json`,
        { headers: authHeader }
      );

      const product = await detailResp.json();

      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: !!recover,
        product,
        order: existing_order || null,
        preview: product?.images?.[0]?.src || image_url,
        preview_url: product?.images?.[0]?.src || image_url
      });
    }

    if (recover === true && existing_order?.id) {
      return res.status(200).json({
        ok: true,
        exists: true,
        duplicate: true,
        recovered: true,
        order: existing_order,
        product: {
          id: null,
          title: `Recovered CHAINVERS ${crop_id}`,
          images: [
            {
              src: image_url
            }
          ]
        },
        preview: image_url,
        preview_url: image_url
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
      variants: [{ id: variantId, price: 2000, is_enabled: true }],
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

    const detailResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products/${product.id}.json`,
      { headers: authHeader }
    );

    const detailData = await detailResp.json();

    if (detailResp.ok && detailData.id) {
      product = detailData;
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
          preview: product?.images?.[0]?.src || image_url,
          preview_url: product?.images?.[0]?.src || image_url,
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
      preview: product?.images?.[0]?.src || image_url,
      preview_url: product?.images?.[0]?.src || image_url
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}