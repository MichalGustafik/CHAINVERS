// /api/getchain.js  (doplnok na začiatku handlera pre GET)
if (req.method === 'GET' && (req.query.json === '1' || (req.headers.accept||'').includes('application/json'))) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) return res.status(500).json({ ok:false, error:'Missing PRINTIFY_API_KEY' });

  // shop_id
  const shops = await fetch('https://api.printify.com/v1/shops.json', {
    headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
  });
  if (!shops.ok) return res.status(shops.status).json({ ok:false, error:'shops.json failed' });
  const slist = await shops.json();
  const shopId = Array.isArray(slist) && slist[0]?.id ? slist[0].id : null;
  if (!shopId) return res.status(500).json({ ok:false, error:'No shop_id' });

  // products
  const prods = await fetch(`https://api.printify.com/v1/shops/${shopId}/products.json`, {
    headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
  });
  if (!prods.ok) return res.status(prods.status).json({ ok:false, error:'products.json failed' });
  const plist = await prods.json();

  return res.status(200).json({
    ok: true,
    shop_id: shopId,
    products: Array.isArray(plist) ? plist.map(p => ({
      id: p.id, title: p.title,
      variants: (p.variants||[]).map(v => ({ id: v.id, title: v.title, is_enabled: !!v.is_enabled }))
    })) : []
  });
}