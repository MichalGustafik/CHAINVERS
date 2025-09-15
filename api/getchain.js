// /api/getchain.js
export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing PRINTIFY_API_KEY in ENV" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST method" });
  }

  try {
    const { crop_id, image_base64 } = req.body;
    if (!crop_id || !image_base64) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing crop_id or image_base64" });
    }

    // === 1) Shop ===
    const shopsResp = await fetch("https://api.printify.com/v1/shops.json", {
      headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
    });
    const shops = await shopsResp.json();
    let shop =
      shops.find((s) =>
        (s.title || "").toLowerCase().includes("chainvers")
      ) || shops[0];
    const shopId = shop?.id;

    if (!shopId) {
      return res
        .status(500)
        .json({ ok: false, error: "No shop found", shops });
    }

    // === 2) Upload obrázka ===
    const uploadResp = await fetch(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PRINTIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_name: `chainvers_${crop_id}.png`,
          contents: image_base64,
        }),
      }
    );
    const uploadData = await uploadResp.json();
    if (!uploadResp.ok || !uploadData.id) {
      return res.status(500).json({
        ok: false,
        error: "Image upload failed",
        resp: uploadData,
      });
    }

    // === 3) Vyber blueprint + provider + variant ===
    const bResp = await fetch(
      "https://api.printify.com/v1/catalog/blueprints.json",
      {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
      }
    );
    const blueprints = await bResp.json();
    let blueprint =
      blueprints.find((b) =>
        (b.title || "").toLowerCase().includes("classic")
      ) || blueprints[0];

    const provResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers.json`,
      { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
    );
    let providers = await provResp.json();
    if (!Array.isArray(providers))
      providers = providers?.providers || providers?.data || [];
    const provider = providers[0];

    const varResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers/${provider.id}/variants.json`,
      { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
    );
    let vjson = await varResp.json();
    let variants = Array.isArray(vjson)
      ? vjson
      : vjson?.variants || vjson?.data || [];
    let variant =
      variants.find((v) => v.is_enabled || v.enabled) || variants[0];

    // === 4) Create Product ===
    const productPayload = {
      title: `CHAINVERS Tee ${crop_id}`,
      description: `Unikátne tričko s panelom ${crop_id}`,
      blueprint_id: blueprint.id,
      print_provider_id: provider.id,
      variants: [
        {
          id: variant.id,
          price: 2000, // cena v centoch
          is_enabled: true,
        },
      ],
      print_areas: [
        {
          variant_ids: [variant.id],
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
    };

    const prodResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PRINTIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(productPayload),
      }
    );
    const prodData = await prodResp.json();

    if (prodResp.ok && prodData.id) {
      return res.status(200).json({
        ok: true,
        product: prodData,
        uploaded_image: uploadData,
        used: { shopId, blueprint, provider, variant },
      });
    } else {
      return res.status(prodResp.status).json({
        ok: false,
        error: "Product creation failed",
        resp: prodData,
        payload_sent: productPayload,
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}