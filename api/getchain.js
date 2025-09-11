// /api/getchain.js
export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY in ENV' });
  }

  // JSON mód pre PHP
  if (req.method === 'GET' && (req.query.json === '1' || (req.headers.accept || '').includes('application/json'))) {
    try {
      // získať shops
      const shopsResp = await fetch('https://api.printify.com/v1/shops.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const shops = await shopsResp.json();
      const shopId = Array.isArray(shops) && shops[0]?.id ? shops[0].id : null;
      if (!shopId) return res.status(500).json({ ok: false, error: 'No shop_id found' });

      // získať produkty
      const prodsResp = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const products = await prodsResp.json();

      return res.status(200).json({
        ok: true,
        shop_id: shopId,
        products: Array.isArray(products)
          ? products.map(p => ({
              id: p.id,
              title: p.title,
              variants: (p.variants || []).map(v => ({
                id: v.id,
                title: v.title,
                is_enabled: !!v.is_enabled
              }))
            }))
          : []
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // fallback – ak sa zavolá bez ?json=1
  return res.status(200).send("CHAINVERS getchain.js API – use ?json=1 for product info.");
}