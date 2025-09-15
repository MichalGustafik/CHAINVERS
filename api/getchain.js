// /api/getchain.js
export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY in ENV' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST method' });
  }

  try {
    const { crop_id, inverse_image } = req.body;
    if (!crop_id || !inverse_image) {
      return res.status(400).json({ ok: false, error: 'Missing crop_id or inverse_image' });
    }

    // 1) Shops
    const shopsResp = await fetch('https://api.printify.com/v1/shops.json', {
      headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
    });
    const shops = await shopsResp.json();
    let shop = shops.find(s => (s.title || '').toLowerCase().includes('chainvers')) || shops[0];
    const shopId = shop?.id;

    // 2) Blueprints
    const bResp = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
      headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
    });
    const blueprints = await bResp.json();
    let blueprint =
      blueprints.find(b => (b.title || '').toLowerCase().includes('classic')) || blueprints[0];

    // 3) Providers
    const provResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers.json`,
      { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
    );
    let providers = await provResp.json();
    if (!Array.isArray(providers)) providers = providers?.providers || providers?.data || [];
    const provider = providers[0];

    // 4) Variants
    const varResp = await fetch(
      `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers/${provider.id}/variants.json`,
      { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
    );
    let vjson = await varResp.json();
    let variants = Array.isArray(vjson) ? vjson : (vjson?.variants || vjson?.data || []);
    let variant = variants.find(v => v.is_enabled || v.enabled) || variants[0];

    // 5) Objednávka
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
                  images: [{ src: inverse_image }],
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
      `https://api.printify.com/v1/shops/${shopId}/orders.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PRINTIFY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const orderData = await orderResp.json();
    if (orderResp.ok && orderData.id) {
      return res.status(200).json({ ok: true, order: orderData });
    } else {
      return res.status(orderResp.status).json({ ok: false, error: 'Order failed', resp: orderData });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}