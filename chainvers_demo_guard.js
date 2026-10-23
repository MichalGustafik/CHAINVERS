// Demo uses the PHP session simulator. It must never reach live service handlers.
export function rejectChainversDemo(req, res) {
  const headers = req.headers || {};
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString('utf8')); } catch (_) {} }
  const marked = value => {
    if (typeof value === 'string') return /^0xdec0de[0-9a-f]+$/i.test(value) || /^(?:cs_demo_|pi_demo_)/i.test(value);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) =>
      ((key === 'demo' || key === 'demo_mode' || key === 'chainvers_demo') && [true, 1, '1', 'true', 'DEMO', 'demo'].includes(item)) || marked(item)
    );
  };
  if (headers['x-chainvers-demo'] || marked(req.query) || marked(body)) {
    res.status(403).json({ok:false, demo:true, error:'demo_live_api_blocked', message:'DEMO processes run only in the temporary PHP session.'});
    return true;
  }
  return false;
}
