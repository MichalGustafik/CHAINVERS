// pages/api/circle-add-address.js
// Vytvorí recipienta v Circle Address Book a vráti jeho ID (adr_...)
// Preferuje CONTRACT_ADDRESS (smart kontrakt) – ak chýba, použije FROM_ADDRESS.
// ENV: CIRCLE_API_KEY, CIRCLE_BASE?(auto), PAYOUT_CHAIN?, CONTRACT_ADDRESS?, FROM_ADDRESS?

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // --- INPUTS (query aj body) ---
    const q = req.query || {};
    const incoming = await readJsonBody(req);
    const apiKey = process.env.CIRCLE_API_KEY;
    const chain  = String(process.env.PAYOUT_CHAIN || "BASE").toUpperCase();

    // adresu zober z priority: ?address | body.address | CONTRACT_ADDRESS | FROM_ADDRESS
    const address =
      normalizeAddr(q.address) ||
      normalizeAddr(incoming.address) ||
      normalizeAddr(process.env.CONTRACT_ADDRESS) ||
      normalizeAddr(process.env.FROM_ADDRESS);

    // voliteľné metadáta
    const nickname = String(q.nickname || incoming.nickname || "CHAINVERS_CONTRACT");
    const email    = String(q.email    || incoming.email    || "ops@example.local");

    // dry-run na rýchly test bez zápisu
    const dryRun = String(q.dryRun || incoming.dryRun || "false").toLowerCase() === "true";

    // --- VALIDÁCIA ---
    if (!apiKey) return res.status(500).json({ error: "Missing CIRCLE_API_KEY" });
    const colonCount = (apiKey.match(/:/g) || []).length;
    if (colonCount !== 2) {
      return res.status(400).json({
        error: "Malformed CIRCLE_API_KEY",
        hint: "Kľúč musí mať formát ENV:ID:SECRET (od mája 2023).",
      });
    }
    if (!address) {
      return res.status(400).json({
        error: "Missing address",
        hint: "Použi ?address=0x... alebo nastav CONTRACT_ADDRESS/ FROM_ADDRESS v ENV.",
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        error: "Invalid address format",
        got: address,
        hint: "Musí to byť EVM adresa 0x + 40 hex znakov.",
      });
    }

    const base = resolveCircleBase(apiKey, process.env.CIRCLE_BASE);

    // --- BODY pre Circle API ---
    const idempotencyKey = uuid();
    const body = {
      idempotencyKey,
      chain,
      address,
      metadata: { nickname, email },
    };

    // Dry-run: nevoláme Circle, len ukážeme, čo by sme poslali
    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        willCall: `${base}/v1/addressBook/recipients`,
        payload: body,
        note: "Nastav dryRun=false alebo vynechaj parameter pre reálny zápis.",
      });
    }

    // --- CALL Circle API ---
    const r = await fetch(`${base}/v1/addressBook/recipients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json || text || "Circle API error",
        sent: body,
        base,
        hints: [
          "Skontroluj CIRCLE_API_KEY a či sedí prostredie (sandbox vs. live).",
          "Ak je kľúč TEST_API_KEY, používaj sandbox (api-sandbox.circle.com).",
          "PAYOUT_CHAIN by mal byť BASE (alebo podľa siete kontraktu).",
        ],
      });
    }

    const addressId = json?.data?.id;
    const status    = json?.data?.status;

    return res.status(200).json({
      ok: true,
      addressId,           // ← vlož do ENV ako CIRCLE_ADDRESS_BOOK_ID
      status,              // "active" atď.
      chain: json?.data?.chain,
      address: json?.data?.address,
      metadata: json?.data?.metadata || { nickname, email },
      base,
      raw: json,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

// ===== Helpers =====
async function readJsonBody(req) {
  // Ak Next už naparsoval body (napr. v dev), použi ho
  if (req.body && typeof req.body === "object") return req.body;
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function resolveCircleBase(apiKey, explicitBase) {
  if (explicitBase && explicitBase.trim()) return explicitBase.trim();
  // ak kľúč začína TEST_API_KEY, použijeme sandbox
  if (String(apiKey).startsWith("TEST_API_KEY")) return "https://api-sandbox.circle.com";
  return "https://api.circle.com";
}

function normalizeAddr(a) {
  if (!a) return "";
  const s = String(a).trim();
  // zjednotiť checksum ponecháme na klientoch; tu kontrolujeme len tvar
  return s;
}