export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing PRINTIFY_API_KEY" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { crop_id, image_base64 } = req.body;
    if (!crop_id || !image_base64) {
      return res.status(400).json({ ok: false, error: "Missing crop_id or image_base64" });
    }

    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };

    // 1) Shop ID
    const shopsResp = await fetch("https://api.printify.com/v1/shops.json", { headers: authHeader });
    const shops = await shopsResp.json();
    const shopId = shops[0]?.id;
    if (!shopId) return res.status(500).json({ ok: false, error: "No shop found" });

    // 2) Skontroluj existujúci produkt
    const prodsResp = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, { headers: authHeader });
    const productsResp = await prodsResp.json();
    const products = Array.isArray(productsResp.data) ? productsResp.data : [];
    const externalId = `chainvers_${crop_id}`;
    let existing = products.find((p) => p.external_id === externalId);

    let product = null;

    // Ak produkt neexistuje → vytvoríme
    if (!existing) {
      // 3) Upload image
      const uploadResp = await fetch(`https://api.printify.com/v1/uploads/images.json`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: `${crop_id}.png`, contents: image_base64 }),
      });
      const uploadData = await uploadResp.json();
      if (!uploadData.id) {
        return res.status(500).json({ ok: false, error: "Upload failed", resp: uploadData });
      }

      // 4) Blueprint / provider / variant
      const blueprintId = 9; // Classic Tee
      const providersResp = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers: authHeader }
      );
      const providers = await providersResp.json();
      const providerId = providers[0]?.id;
      if (!providerId) {
        return res.status(500).json({ ok: false, error: "No provider found", resp: providers });
      }

      const variantsResp = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
        { headers: authHeader }
      );
      const variants = await variantsResp.json();
      const variantId = variants[0]?.id;
      if (!variantId) {
        return res.status(500).json({ ok: false, error: "No variant found", resp: variants });
      }

      // 5) Create product
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
                    angle: 0,
                  },
                ],
              },
            ],
          },
        ],
        external_id: externalId,
      };

      const createProdResp = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(productPayload),
      });
      const created = await createProdResp.json();
      if (!createProdResp.ok || !created.id) {
        return res.status(500).json({ ok: false, error: "Product creation failed", resp: created });
      }
      product = created;

      // 6) Publish product
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
            tags: true,
          }),
        }
      );

      // 7) Create test order
      const orderPayload = {
        external_id: externalId,
        line_items: [
          {
            product_id: product.id,
            variant_id: variantId,
            quantity: 1,
          },
        ],
        address_to: {
          first_name: "CHAIN",
          last_name: "User",
          email: "test@example.com",
          phone: "421900000000",
          country: "SK",
          address1: "Test Street 1",
          city: "Bratislava",
          zip: "81101",
        },
      };
      const orderResp = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      var order = await orderResp.json();
    } else {
      product = existing;
    }

    return res.status(200).json({ ok: true, product, order, exists: !!existing });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
}