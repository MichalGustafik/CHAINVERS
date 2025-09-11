// /api/getchain.js
// GET  -> zobrazí minimalistický „editor“ (drag/zoom) v iFrame
// POST -> zoberie cropId, imageUrl, product ('classic' | 'adidas'),
//         cez Printify API si zistí shop_id + product/variant a vytvorí objednávku

export default async function handler(req, res) {
  const { PRINTIFY_API_KEY, VERCEL_RETURN_URL } = process.env;

  if (!PRINTIFY_API_KEY) {
    res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY env' });
    return;
  }

  if (req.method === 'GET') {
    const cropId   = (req.query.cropId || '').toString();
    const imageUrl = (req.query.imageUrl || '').toString();
    const product  = ((req.query.product || 'classic') === 'adidas') ? 'adidas' : 'classic';

    if (!cropId || !imageUrl) {
      res.status(400).send('Missing cropId or imageUrl');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderEditorHtml({ cropId, imageUrl, product, returnUrl: VERCEL_RETURN_URL || '' }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const cropId   = (body?.cropId || '').toString();
      const imageUrl = (body?.imageUrl || '').toString();
      const product  = (body?.product === 'adidas') ? 'adidas' : 'classic';

      if (!cropId || !imageUrl) {
        res.status(400).json({ ok:false, error:'Missing cropId or imageUrl' });
        return;
      }
      if (!/^https:\/\//i.test(imageUrl)) {
        res.status(400).json({ ok:false, error:'imageUrl must be public HTTPS' });
        return;
      }

      const shopId = await getShopId(PRINTIFY_API_KEY);
      if (!shopId) {
        res.status(500).json({ ok:false, error:'Unable to resolve Printify shop_id' });
        return;
      }

      const { productId, variantId } = await findProductVariantByName(PRINTIFY_API_KEY, shopId, product);
      if (!productId || !variantId) {
        res.status(400).json({ ok:false, error:`Product/variant not found for key '${product}'` });
        return;
      }

      const payload = {
        external_id: `chainvers_${cropId}`,
        line_items: [
          { product_id: productId, variant_id: Number(variantId), quantity: 1 }
        ],
        // Jednoduché priradenie obrázka ako potlače na "front"
        print_areas: [
          {
            variant_ids: [ Number(variantId) ],
            placeholders: [
              { position: "front", images: [{ src: imageUrl }] }
            ]
          }
        ],
        // TODO: doručenie – neskôr doplň z tvojej ChainZuserData (webhook/register)
        address_to: {
          first_name: "CHAIN",
          last_name:  "User",
          email:      "noreply@chainvers.app",
          phone:      "421900000000",
          country:    "SK",
          region:     "",
          address1:   "AutoFill by CHAINVERS",
          city:       "Bratislava",
          zip:        "81101"
        }
      };

      const url = `https://api.printify.com/v1/shops/${encodeURIComponent(shopId)}/orders.json`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PRINTIFY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (resp.ok && data?.id) {
        res.status(200).json({ ok: true, order: data });
      } else {
        res.status(resp.status).json({ ok:false, error:'Printify error', detail: data });
      }
    } catch (e) {
      res.status(500).json({ ok:false, error: String(e) });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).end('Method Not Allowed');
}

// ---- Helpers ----

async function getShopId(apiKey) {
  const r = await fetch('https://api.printify.com/v1/shops.json', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
}

async function findProductVariantByName(apiKey, shopId, key) {
  // key: 'classic' | 'adidas' -> hľadáme v názve produktu
  const r = await fetch(`https://api.printify.com/v1/shops/${encodeURIComponent(shopId)}/products.json`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!r.ok) return { productId: null, variantId: null };

  const list = await r.json();
  const want = key === 'adidas' ? 'adidas' : 'classic';

  // nájdi prvý produkt, kde title obsahuje dané kľúčové slovo
  const product = Array.isArray(list) ? list.find(p =>
    typeof p?.title === 'string' && p.title.toLowerCase().includes(want)
  ) : null;

  if (!product?.id || !Array.isArray(product?.variants) || product.variants.length === 0) {
    return { productId: null, variantId: null };
  }

  // zober prvý zapnutý variant (alebo prvý)
  const variant = product.variants.find(v => v?.is_enabled) || product.variants[0];
  return { productId: product.id, variantId: variant.id };
}

function renderEditorHtml({ cropId, imageUrl, product, returnUrl }) {
  const safe = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  return `<!doctype html>
<html lang="sk"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CHAINVERS – Editor</title>
<style>
  :root{--bg:#0b0016;--card:#1a0533;--pri:#00ffe1;--acc:#fbd308;--txt:#e9e9ef;}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Segoe UI,Roboto,Arial}
  .wrap{max-width:1000px;margin:0 auto;padding:20px}
  .card{background:var(--card);border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:18px}
  h1{margin:0 0 14px;font-weight:800;letter-spacing:.2px}
  .stage{position:relative;aspect-ratio:3/4;background:#120022;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .shirt{max-width:100%;max-height:100%;opacity:.5;user-select:none;pointer-events:none}
  .design{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(1);cursor:move;user-select:none;touch-action:none;max-width:80%;max-height:80%}
  .controls{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .btn{appearance:none;border:0;border-radius:12px;padding:12px 16px;font-weight:700;cursor:pointer}
  .btn-ghost{background:#240a42;color:var(--pri)}
  .btn-cta{background:var(--acc);color:#000}
  .meta{opacity:.85;font-size:.9rem;margin-top:8px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Uprav pozíciu dizajnu</h1>
      <div class="stage" id="stage">
        <img class="shirt" src="https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=60" alt="shirt">
        <img class="design" id="design" src="${safe(imageUrl)}" alt="design">
      </div>
      <div class="controls">
        <button class="btn btn-ghost" id="zoomOut">− Zmenšiť</button>
        <button class="btn btn-ghost" id="zoomIn">+ Zväčšiť</button>
        <button class="btn btn-cta" id="confirm">Potvrdiť & objednať</button>
      </div>
      <div class="meta">Produkt: <b>${product==='adidas'?'Adidas tričko':'Klasické tričko'}</b> &middot; Crop ID: <b>${safe(cropId)}</b></div>
    </div>
  </div>
<script>
  const design = document.getElementById('design');
  let scale=1, dragging=false, sx=0, sy=0, ox=0, oy=0;

  design.addEventListener('pointerdown', e => { dragging=true; sx=e.clientX; sy=e.clientY; design.setPointerCapture(e.pointerId); e.preventDefault(); });
  window.addEventListener('pointermove', e => {
    if(!dragging) return;
    ox += e.clientX - sx; oy += e.clientY - sy; sx=e.clientX; sy=e.clientY;
    design.style.transform = \`translate(calc(-50% + \${ox}px), calc(-50% + \${oy}px)) scale(\${scale})\`;
  });
  window.addEventListener('pointerup', () => dragging=false);
  document.getElementById('zoomIn').onclick  = () => { scale=Math.min(scale*1.1,3); design.style.transform=\`translate(calc(-50% + \${ox}px), calc(-50% + \${oy}px)) scale(\${scale})\`; };
  document.getElementById('zoomOut').onclick = () => { scale=Math.max(scale/1.1,.3); design.style.transform=\`translate(calc(-50% + \${ox}px), calc(-50% + \${oy}px)) scale(\${scale})\`; };

  document.getElementById('confirm').onclick = async () => {
    const body = { cropId: "${safe(cropId)}", imageUrl: "${safe(imageUrl)}", product: "${product}", transform:{ offsetX: ox, offsetY: oy, scale } };
    const r = await fetch(location.pathname, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const resp = await r.json().catch(()=>({}));
    const ret = "${safe(returnUrl)}";
    const back = ret || "/";
    const url = new URL(back, location.origin);
    if (resp.ok) {
      url.searchParams.set('status','ok');
      url.searchParams.set('order_id', resp.order?.id || '');
      url.searchParams.set('crop_id', "${safe(cropId)}");
    } else {
      url.searchParams.set('status','error');
      url.searchParams.set('message', resp.error || 'Order failed');
      url.searchParams.set('crop_id', "${safe(cropId)}");
    }
    location.href = url.toString();
  };
</script>
</body></html>`;
}