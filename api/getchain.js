export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing PRINTIFY_API_KEY" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { crop_id, image_base64, user } = req.body;
    if (!crop_id || !image_base64) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing crop_id or image" });
    }

    const authHeader = { Authorization: `Bearer ${PRINTIFY_API_KEY}` };

    // --- zisti shop ID ---
    const shopsResp = await fetch("https://api.printify.com/v1/shops.json", {
      headers: authHeader,
    });
    const shops = await shopsResp.json();
    const shopId = shops[0]?.id;
    if (!shopId)
      return res.status(500).json({ ok: false, error: "No shop found" });

    // --- získaj produkty v shope ---
    const prodsResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      { headers: authHeader }
    );
    const productsResp = await prodsResp.json();
    const products = Array.isArray(productsResp.data) ? productsResp.data : [];

    const externalId = `chainvers_${crop_id}`;
    let existing = products.find((p) => p.external_id === externalId);

    let product = null;

    if (existing) {
      product = existing;
    } else {
      // --- upload obrázka ---
      const uploadResp = await fetch(
        `https://api.printify.com/v1/uploads/images.json`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: `${crop_id}.png`,
            contents: image_base64,
          }),
        }
      );
      const uploadData = await uploadResp.json();
      if (!uploadData.id) throw new Error("Upload failed");

      // --- vytvor produkt (Classic Unisex Tee) ---
      const payload = {
        title: `CHAINVERS Tee ${crop_id}`,
        description: `Unikátne tričko s panelom ${crop_id}`,
        blueprint_id: 9, // classic unisex tee
        print_provider_id: 1,
        variants: [{ id: 4012, price: 2000, is_enabled: true }],
        print_areas: [
          {
            variant_ids: [4012],
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

      const createProd = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/products.json`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      product = await createProd.json();
    }

    // --- vytvor test objednávku (iba ak produkt ešte neexistoval) ---
    let order = null;
    if (!existing && product?.id) {
      const orderPayload = {
        external_id: externalId,
        line_items: [
          {
            product_id: product.id,
            variant_id: product.variants[0].id,
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

      const orderResp = await fetch(
        `https://api.printify.com/v1/shops/${shopId}/orders.json`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        }
      );
      order = await orderResp.json();
    }

    return res
      .status(200)
      .json({ ok: true, product, order, exists: !!existing });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message, stack: e.stack });
  }
}