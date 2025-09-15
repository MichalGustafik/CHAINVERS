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
    return res
      .status(405)
      .json({ ok: false, error: "Use POST method" });
  }

  try {
    const { crop_id, image_base64, inverse_image } = req.body;
    if (!crop_id || (!image_base64 && !inverse_image)) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing crop_id and image" });
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

    // === 2) Upload obrázka ===
    let uploadBody = { file_name: `chainvers_${crop_id}.png` };

    if (image_base64) {
      uploadBody.contents = image_base64; // Base64 obsah
    } else if (inverse_image) {
      const baseUrl = "https://chainvers.infinityfreeapp.com/";
      const imageUrl = inverse_image.startsWith("http")
        ? inverse_image
        : baseUrl + inverse_image.replace(/^\/+/, "");
      uploadBody.url = imageUrl;
    }

    const uploadResp = await fetch(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PRINTIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(uploadBody),
      }
    );
    const uploadData = await uploadResp.json();
    if (!uploadResp.ok || !uploadData.id) {
      return res
        .status(500)
        .json({ ok: false, error: "Image upload failed", resp: uploadData });
    }

    // === 3) Blueprint + Provider + Variant ===
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

    // === 4) Draft objednávka ===
    const payload = {
      external_id: "chainvers_" + crop_id,
      line_items: [
        {
          blueprint_id: blueprint.id,
          print_provider_id: provider.id,
          variant_id: variant.id,
          quantity: 1,
          print_areas: [
            {
              placeholders: [
                {
                  position: "front",
                  images: [
                    {
                      src: uploadData.file_url, // URL z uploadu
                      scale: 1,
                      x: 0.5,
                      y: 0.5,
                      angle: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      address_to: {
        first_name: "CHAIN",
        last_name: "User",
        email: "test@example.com",
        phone: "421900000000",
        country: "SK",
        region: "",
        address1: "Test Street 1",
        city: "Bratislava",
        zip: "81101",
      },
    };

    const orderResp = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/orders.json?confirm=false`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PRINTIFY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const orderData = await orderResp.json();
    if (orderResp.ok && orderData.id) {
      return res.status(200).json({
        ok: true,
        order: orderData,
        uploaded_image: uploadData,
        used: { shopId, blueprint, provider, variant },
      });
    } else {
      return res.status(orderResp.status).json({
        ok: false,
        error: "Order failed",
        resp: orderData,
        payload_sent: payload,
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}