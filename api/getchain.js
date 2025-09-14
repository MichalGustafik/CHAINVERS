// /api/getchain.js
export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY in ENV' });
  }

  try {
    // === MODE 1: Zoznam blueprintov (katalóg všetkých produktov) ===
    if (req.query.blueprints === '1') {
      const bResp = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      if (!bResp.ok) {
        return res.status(bResp.status).json({ ok: false, error: 'blueprints.json failed' });
      }
      const blueprints = await bResp.json();
      return res.status(200).json({ ok: true, type: 'blueprints', count: blueprints.length, blueprints });
    }

    // === MODE 2: Debug pre PHP (shop + produkty) ===
    if (req.method === 'GET' && (req.query.json === '1' || (req.headers.accept || '').includes('application/json'))) {
      const shopsResp = await fetch('https://api.printify.com/v1/shops.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const shops = await shopsResp.json();
      const shopId = Array.isArray(shops) && shops[0]?.id ? shops[0].id : null;
      if (!shopId) {
        return res.status(500).json({ ok: false, error: 'No shop_id found', shops });
      }

      const prodsResp = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const products = await prodsResp.json();

      return res.status(200).json({
        ok: true,
        type: 'shop-products',
        shop_id: shopId,
        shops,
        products: Array.isArray(products) ? products : []
      });
    }

    // fallback
    return res.status(200).send("CHAINVERS getchain.js API – použi ?json=1 alebo ?blueprints=1");
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
