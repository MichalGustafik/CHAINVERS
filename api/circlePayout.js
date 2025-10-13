// lib/circle_payout.js
// Minimal, production-ready Circle payout helper bez Address Booku.
//
// ENV (už ich máš):
// - CIRCLE_API_KEY         → "ENV:KEYID:SECRET" (nový formát po 05/2023)
// - CIRCLE_BASE            → (nechaj prázdne; default = https://api.circle.com)
// - PAYOUT_CHAIN           → "BASE" (alebo iné: ETH, POLYGON, …)
// - CONTRACT_ADDRESS       → adresa tvojho kontraktu (kam posielame)
// - OPTIONAL: DEBUG_CIRCLE → "true" pre extra logy

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_BASE = process.env.CIRCLE_BASE || "https://api.circle.com";
const PAYOUT_CHAIN = (process.env.PAYOUT_CHAIN || "BASE").toUpperCase();
const DEFAULT_TO = process.env.CONTRACT_ADDRESS;

function assertEnv() {
  if (!CIRCLE_API_KEY) throw new Error("Missing CIRCLE_API_KEY");
  // nový formát má 2 dvojbodky → 3 segmenty
  const parts = CIRCLE_API_KEY.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed CIRCLE_API_KEY (must be ENV:KEYID:SECRET)");
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0, v = c === "x" ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

async function callCircle(path, { method = "GET", body } = {}) {
  assertEnv();
  const url = `${CIRCLE_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${CIRCLE_API_KEY}`,
    "Content-Type": "application/json",
  };
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (process.env.DEBUG_CIRCLE === "true") {
    console.log("[circle] req", method, url, "payload:", body);
    console.log("[circle] res", res.status, text.slice(0, 800));
  }
  if (!res.ok) {
    const err = json?.error || json || text || `HTTP ${res.status}`;
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    const e = new Error(`Circle API error: ${msg}`);
    e.status = res.status;
    e.response = json || text;
    throw e;
  }
  return json;
}

/**
 * Vytvorí payout priamo na EOA/kontrakt (typ "crypto").
 * @param {Object} p
 * @param {string|number} p.amount      - napr. "30.5" (string odporúčané), alebo number
 * @param {string}        [p.currency]   - default "USDC" (alebo "EURC")
 * @param {string}        [p.to]         - cieľová adresa; default = CONTRACT_ADDRESS
 * @param {string}        [p.chain]      - default = PAYOUT_CHAIN
 * @param {string}        [p.ref]        - referencia (napr. Stripe PI) – zapíšeme do result.ref
 * @returns {Promise<{ok:true,id:string,status:string,chain:string,amount:any,ref?:string}>}
 */
export async function createPayout({ amount, currency = "USDC", to = DEFAULT_TO, chain = PAYOUT_CHAIN, ref } = {}) {
  if (!to) throw new Error("Missing destination address (CONTRACT_ADDRESS not set)");
  if (amount === undefined || Number(amount) <= 0) throw new Error("Invalid amount");

  const payload = {
    idempotencyKey: uuid(),
    destination: { type: "crypto", address: to },
    amount: { amount: String(amount), currency },
    chain,
  };

  const json = await callCircle("/v1/payouts", { method: "POST", body: payload });
  const d = json?.data || json;
  return {
    ok: true,
    id: d?.id,
    status: d?.status || "created",
    chain: d?.chain || chain,
    amount: d?.amount || payload.amount,
    ref,
  };
}

/**
 * Zistí stav payoutu podľa ID (vráteného z createPayout).
 * @param {string} payoutId
 * @returns {Promise<{ok:true,id:string,status:string,chain?:string,amount?:any}>}
 */
export async function getPayoutStatus(payoutId) {
  if (!payoutId) throw new Error("Missing payoutId");
  const json = await callCircle(`/v1/payouts/${payoutId}`, { method: "GET" });
  const d = json?.data || json;
  return {
    ok: true,
    id: d?.id,
    status: (d?.status || "").toLowerCase(), // queued|created|pending|complete|failed
    chain: d?.chain,
    amount: d?.amount,
  };
}
