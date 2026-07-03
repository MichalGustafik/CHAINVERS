export const maxDuration = 60;

export default async function handler(req, res) {

  const origin = req.headers.origin || "";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: "Missing API key" });
  }

  let body = req.body || {};

  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }

  const action = body.action;

  const headers = {
    Authorization: `Bearer ${PRINTIFY_API_KEY}`
  };

  async function safeFetch(url){
    try{
      const r = await fetch(url,{headers});
      const t = await r.text();
      try{return JSON.parse(t);}catch{return {};}
    }catch{
      return {};
    }
  }

  async function loadBlueprints(){
    return await safeFetch("https://api.printify.com/v1/catalog/blueprints.json");
  }

  async function loadProviders(id){
    return await safeFetch(`https://api.printify.com/v1/catalog/blueprints/${id}/print_providers.json`);
  }

  async function loadVariants(b,p){
    return await safeFetch(`https://api.printify.com/v1/catalog/blueprints/${b}/print_providers/${p}/variants.json`);
  }

  // =========================
  // 🚀 FAST CATALOG
  // =========================
  if(action === "mockchain_catalog"){

    const blueprints = await loadBlueprints();

    const offset = Number(body.offset || 0);
    const limit = Number(body.limit || 10);

    const products = [];
    let count = 0;

    for(let i=offset;i<blueprints.length;i++){

      const bp = blueprints[i];
      const title = (bp.title || "").toLowerCase();

      if(!title.includes("unisex")) continue;

      let image = null;

      if(Array.isArray(bp.images)){
        const img = bp.images.find(x=>x.src || x.url);
        if(img) image = img.src || img.url;
      }

      products.push({
        key: String(bp.id),
        label: bp.title,
        thumbnail: image,
        print_provider_title: "Printify"
      });

      count++;
      if(count >= limit) break;
    }

    return res.json({
      ok:true,
      products,
      nextOffset: offset + limit
    });
  }

  // =========================
  // 🔥 VARIANTS (FIXED)
  // =========================
  if(action === "get_variants"){

    try{

      const blueprint_id = body.blueprint_id;

      const providers = await loadProviders(blueprint_id);

      // ❗ fallback keď nič
      if(!providers || !providers.length){
        return res.json({
          ok:true,
          colors:["black","white"],
          sizes:["M","L"],
          images:[]
        });
      }

      const provider = providers[0];

      const data = await loadVariants(blueprint_id, provider.id);

      const variants = data?.variants || [];

      const colors = [];
      const sizes = [];
      const images = [];

      for(const v of variants){

        const title = v.title || "";
        const parts = title.split("/").map(x=>x.trim());

        for(const p of parts){
          if(p.match(/^(XS|S|M|L|XL|2XL|3XL)$/i)) sizes.push(p);
          else colors.push(p);
        }

        // 🔥 skúsiť získať obrázok
        if(v.image) images.push(v.image);
        if(v.preview_url) images.push(v.preview_url);
      }

      return res.json({
        ok:true,
        colors:[...new Set(colors)],
        sizes:[...new Set(sizes)],
        images:[...new Set(images)]
      });

    }catch(e){

      // 🔥 fallback keď API padne
      return res.json({
        ok:true,
        colors:["black","white"],
        sizes:["M","L"],
        images:[]
      });
    }
  }

  return res.json({ ok:false });
}