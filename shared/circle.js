const BASE = process.env.CIRCLE_BASE || "https://api.circle.com";

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function resolveDestination() {
  if (process.env.CIRCLE_ADDRESS_BOOK_ID) {
    return { type: "address_book", id: process.env.CIRCLE_ADDRESS_BOOK_ID };
  }
  if (process.env.CIRCLE_DESTINATION_WALLET_ID) {
    return { type: "wallet", id: process.env.CIRCLE_DESTINATION_WALLET_ID };
  }
  if (process.env.CIRCLE_BLOCKCHAIN_ADDRESS) {
    return {
      type: "blockchain",
      address: process.env.CIRCLE_BLOCKCHAIN_ADDRESS,
      chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
    };
  }
  throw new Error("Missing Circle destination configuration");
}

function buildHeaders(idempotencyKey) {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("Missing CIRCLE_API_KEY");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

export async function circlePayout({ amount, currency }) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Missing or invalid Circle payout amount");
  }

  const destination = resolveDestination();
  const idempotencyKey = uuid();
  const headers = buildHeaders(idempotencyKey);
  const body = {
    idempotencyKey,
    destination,
    amount: {
      amount: numericAmount.toFixed(2),
      currency: (currency || process.env.CIRCLE_PAYOUT_CURRENCY || "USDC").toUpperCase(),
    },
    chain: (process.env.PAYOUT_CHAIN || "BASE").toUpperCase(),
  };

  if (process.env.CIRCLE_SOURCE_WALLET_ID) {
    body.sourceWalletId = process.env.CIRCLE_SOURCE_WALLET_ID;
  }

  const metadata = {};
  if (process.env.CIRCLE_BENEFICIARY_EMAIL) {
    metadata.beneficiaryEmail = process.env.CIRCLE_BENEFICIARY_EMAIL;
  }
  if (process.env.CIRCLE_BENEFICIARY_NAME) {
    metadata.beneficiaryName = process.env.CIRCLE_BENEFICIARY_NAME;
  }
  if (Object.keys(metadata).length) {
    body.metadata = metadata;
  }

  const response = await fetch(`${BASE}/v1/payouts`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    console.warn("[circle] Failed to parse response", err);
  }

  if (!response.ok) {
    throw new Error(`Circle payout failed (${response.status}): ${text || response.statusText}`);
  }

  return json?.data ?? json ?? { raw: text };
}
