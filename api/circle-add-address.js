// pages/api/circle-add-address.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const q = req.query || {};
    const incoming = await readJsonBody(req);
    const apiKey = process.env.CIRCLE_API_KEY;
    const chain  = String(process.env.PAYOUT_CHAIN || "BASE").toUpperCase();

    const address =
      normalizeAddr(q.address) ||
      normalizeAddr(incoming.address) ||
      normalizeAddr(process.env.CONTRACT_ADDRESS) ||
      normalizeAddr(process.env.FROM_ADDRESS);

    const nickname = String(q.nickname || incoming.nickname || "CHAINVERS_CONTRACT");
    const email    = String(q.email    || incoming.email    || "ops@example.local");
    const dryRun   = String(q.dryRun   || incoming.dryRun   || "false").toLowerCase() === "true";

    if (!apiKey) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
    const colonCount = (apiKey.match(/:/g) || []).length;
    if (colonCount !== 2) return res.status(400).json({ error: "Malformed CIRCLE_API_KEY (ENV:ID:SECRET)" });
    if (!address) return res.status(400).json({ error: "Missing address (set CONTRACT_ADDRESS or FROM_ADDRESS or ?address=)" });
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: "Invalid EVM address", got: address });

    const base = resolveCircleBase(apiKey, process.env.CIRCLE_BASE);

    const body = { idempotencyKey: uuid(), chain, address, metadata: { nickname, email } };

    if (dryRun) return res.status(200).json({ ok: true, dryRun: true, willCall: `${base}/v1/addressBook/recipients`, payload: body });

    const r = await fetch(`${base}/v1/addressBook/recipients`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type":"application/json" }, body: JSON.stringify(body)
    });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok) return res.status(r.status).json({ ok:false, error: json || text || "Circle API error", sent: body, base });

    const addressId = json?.data?.id;
    const status    = json?.data?.status;

    return res.status(200).json({ ok:true, addressId, status, chain: json?.data?.chain, address: json?.data?.address, metadata: json?.data?.metadata || { nickname, email }, base, raw: json });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message || String(e) });
  }
}

// helpers
async function readJsonBody(req){ if(req.body && typeof req.body==="object") return req.body; try{const chunks=[];for await(const ch of req) chunks.push(ch); const raw=Buffer.concat(chunks).toString("utf8"); return raw?JSON.parse(raw):{};}catch{return{};} }
function uuid(){ if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=(Math.random()*16)|0,v=c==="x"?r:(r&0x3)|0x8;return v.toString(16);});}
function resolveCircleBase(apiKey, explicitBase){ if(explicitBase && explicitBase.trim()) return explicitBase.trim(); if(String(apiKey).startsWith("TEST_API_KEY")) return "https://api-sandbox.circle.com"; return "https://api.circle.com"; }
function normalizeAddr(a){ if(!a) return ""; return String(a).trim(); }