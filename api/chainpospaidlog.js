// pages/api/chainpospaidlog.js
export default async function handler(req, res) {
  const started = Date.now();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (!body || typeof body !== "object") {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    }

    const { userId = "anon", sessionId = "", traceId = uuid(), stage = "UNSPECIFIED", level = "info", data = {} } = body || {};
    const maskKeys = parseMaskList(process.env.LOG_MASK_KEYS || "");
    const truncBytes = clampInt(process.env.LOG_TRUNCATE_BYTES, 1024, 250_000, 50_000);

    const entry = {
      ts: new Date().toISOString(),
      userId, sessionId, traceId, stage, level: validLevel(level),
      data: maskAndTruncate(data, maskKeys, truncBytes),
      ua: req.headers["user-agent"] || "", ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    };

    logToConsole(entry);

    const tasks = [];
    const userSink = process.env.LOG_USER_DIR_URL;
    if (userSink) tasks.push(postJson(userSink, { userId, sessionId, traceId, stage, level: entry.level, data: entry.data, ts: entry.ts }, "user-dir"));
    const httpSink = process.env.LOG_HTTP_URL;
    if (httpSink) tasks.push(postJson(httpSink, entry, "http-sink"));

    const settle = await promiseAllWithTimeout(tasks, 1500);
    const summary = settle.map(s => s.meta);

    return res.status(200).json({ ok: true, traceId, tookMs: Date.now() - started, forwarded: summary });
  } catch (e) {
    console.error("[POSPAIDLOG] FATAL", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// helpers
function uuid(){ if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=(Math.random()*16)|0,v=c==="x"?r:(r&0x3)|0x8;return v.toString(16);});}
function validLevel(lv){ const s=String(lv||"").toLowerCase(); return ["info","warn","error","debug"].includes(s)?s:"info"; }
function parseMaskList(csv){ return csv.split(",").map(s=>s.trim()).filter(Boolean).map(s=>s.toLowerCase()); }
function maskAndTruncate(obj, maskKeys, limitBytes){ const masked=maskDeep(obj, maskKeys); const json=JSON.stringify(masked); if(Buffer.byteLength(json||"","utf8")<=limitBytes) return masked; return { _truncated:true, preview: json.slice(0, Math.floor(limitBytes*0.9)) }; }
function maskDeep(val, maskKeys){ if(!val || typeof val!=="object") return val; if(Array.isArray(val)) return val.map(v=>maskDeep(v, maskKeys)); const out={}; for(const [k,v] of Object.entries(val)){ out[k]=maskKeys.includes(k.toLowerCase())?"***":maskDeep(v, maskKeys);} return out; }
async function postJson(url, payload, tag){ const headers={"Content-Type":"application/json"}; const auth=process.env.LOG_HTTP_AUTH; if(auth) headers["Authorization"]=auth; try{ const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(payload)}); const text=await r.text(); return { ok:r.ok, status:r.status, tag, meta:{ tag, status:r.status, url, ok:r.ok, bodyPreview:text.slice(0,200) } }; }catch(e){ console.error(`[POSPAIDLOG] forward ${tag} failed`, e?.message||e); return { ok:false, status:0, tag, meta:{ tag, status:0, url, ok:false, error: e?.message||String(e)} }; } }
function clampInt(s,min,max,def){ const n=Number(s); if(!Number.isFinite(n)) return def; return Math.max(min, Math.min(max, Math.floor(n))); }
async function promiseAllWithTimeout(promises, timeoutMs){ if(!promises || promises.length===0) return []; let timer; const to=new Promise(res=>{ timer=setTimeout(()=>res(promises.map(()=>({ok:false,meta:{tag:"timeout"}}))), timeoutMs);}); const done=await Promise.race([Promise.all(promises), to]); if(timer) clearTimeout(timer); return done; }