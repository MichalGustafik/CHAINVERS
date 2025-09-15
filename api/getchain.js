// /api/getchain.js
export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY in ENV' });
  }

  try {
    if (req.query.blueprints === '1') {
      // 1) Shops
      const shopsResp = await fetch('https://api.printify.com/v1/shops.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
      });
      const shops = await shopsResp.json();
      if (!Array.isArray(shops) || shops.length === 0) {
        return res.status(500).json({ ok: false, error: 'No shops found', raw: shops });
      }
      // preferuj CHAINVERS shop
      let shop = shops.find(s => (s.title || '').toLowerCase().includes('chainvers')) || shops[0];
      const shopId = shop?.id;

      // 2) Blueprints
      const bResp = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` },
      });
      const blueprints = await bResp.json();
      if (!Array.isArray(blueprints) || blueprints.length === 0) {
        return res.status(500).json({ ok: false, error: 'No blueprints available' });
      }

      const q = (req.query.q || '').toString().toLowerCase().trim();
      let blueprint =
        (q && blueprints.find(b => (b.title || '').toLowerCase().includes(q))) ||
        blueprints.find(b => (b.title || '').toLowerCase().includes('classic')) ||
        blueprints[0];

      // 3) Providers
      const provResp = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers.json`,
        { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
      );
      let providers = await provResp.json();
      if (!Array.isArray(providers)) providers = providers?.providers || providers?.data || [];
      if (!providers || providers.length === 0) {
        return res.status(500).json({ ok: false, error: 'No providers for blueprint', blueprint });
      }
      const provider = providers[0];

      // 4) Variants
      const varResp = await fetch(
        `https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers/${provider.id}/variants.json`,
        { headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` } }
      );
      let vjson = await varResp.json();
      let variants = Array.isArray(vjson) ? vjson : (vjson?.variants || vjson?.data || []);
      if (!variants || variants.length === 0) {
        return res.status(500).json({ ok: false, error: 'No variants for provider', provider });
      }
      let variant = variants.find(v => v.is_enabled || v.enabled) || variants[0];

      return res.status(200).json({
        ok: true,
        shop_id: shopId,
        blueprint: { id: blueprint.id, title: blueprint.title },
        provider: { id: provider.id, title: provider.title || provider.name },
        variant: { id: variant.id, title: variant.title },
      });
    }

    return res.status(200).send('CHAINVERS getchain.js API – use ?blueprints=1 (&q=classic/hoodie/mug)');
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}