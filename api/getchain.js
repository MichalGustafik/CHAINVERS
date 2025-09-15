// /api/getchain.js
export default async function handler(req, res) {
  const { PRINTIFY_API_KEY } = process.env;
  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing PRINTIFY_API_KEY in ENV' });
  }

  try {
    // === Blueprint mód ===
    if (req.query.blueprints === '1') {
      const bResp = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const blueprints = await bResp.json();

      // nájdi classic tee
      let blueprint = blueprints.find(b => b.title.toLowerCase().includes('classic'));
      if (!blueprint) blueprint = blueprints[0]; // fallback

      // nájdi providera pre blueprint
      const provResp = await fetch(`https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers.json`, {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const providers = await provResp.json();
      const provider = providers[0]; // prvý provider

      // nájdi varianty
      const varResp = await fetch(`https://api.printify.com/v1/catalog/blueprints/${blueprint.id}/print_providers/${provider.id}/variants.json`, {
        headers: { Authorization: `Bearer ${PRINTIFY_API_KEY}` }
      });
      const variants = await varResp.json();
      const variant = variants[0]; // prvý variant

      return res.status(200).json({
        ok: true,
        blueprint,
        provider,
        variant
      });
    }

    // fallback
    return res.status(200).send("CHAINVERS getchain.js API – použi ?blueprints=1 pre blueprinty");
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}