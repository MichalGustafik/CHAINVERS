// pages/api/chainvers.js
import Stripe from "stripe";
import crypto from "crypto";
import Web3 from "web3";
import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";
import { ethers } from "ethers";

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

// ======================================================
//  ENVIRONMENT VARS
// ======================================================
function readEnv() {
  const env = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    INF_FREE_URL: process.env.INF_FREE_URL || "https://chainvers.free.nf",

    COINBASE_API_KEY: process.env.COINBASE_API_KEY || "",
    COINBASE_API_SECRET: process.env.COINBASE_API_SECRET || "",
    COINBASE_BASE_URL: process.env.COINBASE_BASE_URL || "https://api.coinbase.com",

    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "",
  };
  return env;
}

function mask(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return s[0] + "****";
  return s.slice(0, 6) + "..." + s.slice(-4);
}

// ======================================================
//  MAIN HANDLER
// ======================================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const action = String(req.query?.action || "").toLowerCase();

  console.log("[CHAINVERS] Incoming", {
    method: req.method,
    action,
  });

  try {
    if (action === "create_payment_proxy") {
      return createPaymentProxy(req, res);
    }

    if (action === "stripe_session_status") {
      return stripeSessionStatus(req, res);
    }

    if (action === "stripe_refund") {
      return stripeRefund(req, res);
    }

    if (action === "stripe_webhook") {
      return stripeWebhook(req, res);
    }

    if (action === "coinbase_auto_buy") {
      return coinbaseAutoBuy(req, res);
    }

    if (action === "plugin") {
      return chainversPluginScript(req, res);
    }

    if (action === "translate") {
      return chainversTranslate(req, res);
    }

    if (action === "rates") {
      return chainversRates(req, res);
    }

    if (action === "mintchain") {
      return mintChainAction(req, res);
    }

    if (action === "getchain") {
      return getChainAction(req, res);
    }

    if (
      action === "create_wallet" ||
      action === "create-wallet"
    ) {
      return createWalletAction(req, res);
    }

    if (action === "ping") {
      return res.status(200).json({
        ok: true,
        now: new Date().toISOString(),
      });
    }

    if (action === "env") {
      return debugEnv(req, res);
    }

    return res.status(404).json({
      error: "Unknown ?action=",
    });

  } catch (e) {
    console.error("[CHAINVERS] ERROR", e);

    return res.status(500).json({
      error: e?.message || String(e),
    });
  }
}

// ======================================================
//  DEBUG ENV
// ======================================================
async function debugEnv(req, res) {
  const E = readEnv();

  const out = {
    STRIPE_SECRET_KEY: mask(E.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: mask(E.STRIPE_WEBHOOK_SECRET),
    INF_FREE_URL: E.INF_FREE_URL,

    COINBASE_API_KEY: mask(E.COINBASE_API_KEY),
    COINBASE_API_SECRET: E.COINBASE_API_SECRET ? "🔒 present" : null,
    COINBASE_BASE_URL: E.COINBASE_BASE_URL,

    CONTRACT_ADDRESS: mask(E.CONTRACT_ADDRESS),
  };

  return res.status(200).json(out);
}

// ======================================================
//  STRIPE: Create Checkout Session
// ======================================================
async function createPaymentProxy(req, res) {
  const E = readEnv();

  if (!E.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      error: "Missing STRIPE_SECRET_KEY",
    });
  }

  try {
    const body = await readJson(req);

    const {
      amount,
      currency,
      description,
      crop_data,
      user_address,
    } = body || {};

    if (!amount || !currency) {
      return res.status(400).json({
        error: "Missing amount or currency",
      });
    }

    const stripe = new Stripe(E.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      payment_method_types: [
        "card",
      ],

      line_items: [
        {
          price_data: {
            currency: String(currency).toLowerCase(),

            product_data: {
              name: description || "CHAINVERS objednávka",
            },

            unit_amount: Math.round(Number(amount) * 100),
          },

          quantity: 1,
        },
      ],

      metadata: {
        crop_data: JSON.stringify(crop_data || {}),
        user_address: user_address || "unknown",
      },

      success_url:
        `${E.INF_FREE_URL}/thankyou.php?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${E.INF_FREE_URL}/index.php`,
    });

    console.log("[createPaymentProxy] session created", session.id);

    return res.status(200).json({
      checkout_url: session.url,
    });

  } catch (err) {
    console.error(
      "[createPaymentProxy] error",
      err?.message || err
    );

    return res.status(500).json({
      error: err?.message || String(err),
    });
  }
}

// ======================================================
//  STRIPE: Session Status
// ======================================================
async function stripeSessionStatus(req, res) {
  const E = readEnv();

  const sessionId = req.query?.session_id;

  if (!sessionId) {
    return res.status(400).json({
      error: "Missing session_id",
    });
  }

  try {
    const stripe = new Stripe(E.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const session =
      await stripe.checkout.sessions.retrieve(
        sessionId,
        {
          expand: [
            "payment_intent",
          ],
        }
      );

    return res.status(200).json({
      id: session.id,
      payment_status: session.payment_status,
      payment_intent: session.payment_intent?.id,
      metadata: session.metadata || {},
    });

  } catch (e) {
    console.error(
      "[stripeSessionStatus] error",
      e?.message || e
    );

    return res.status(500).json({
      error: e?.message || String(e),
    });
  }
}

// ======================================================
//  STRIPE: Refund payment
// ======================================================
async function stripeRefund(req, res) {
  const E = readEnv();

  if (!E.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing STRIPE_SECRET_KEY",
    });
  }

  try {
    const input =
      req.method === "POST"
        ? await readJson(req)
        : req.query;

    const paymentIntent =
      input.payment_intent ||
      input.paymentIntent ||
      input.paymentIntentId ||
      "";

    const sessionId =
      input.session_id ||
      input.sessionId ||
      "";

    const reason =
      input.reason ||
      "requested_by_customer";

    if (!paymentIntent && !sessionId) {
      return res.status(400).json({
        ok: false,
        error: "Missing payment_intent or session_id",
      });
    }

    const stripe = new Stripe(E.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    let finalPaymentIntent = paymentIntent;

    if (!finalPaymentIntent && sessionId) {
      const session =
        await stripe.checkout.sessions.retrieve(
          sessionId,
          {
            expand: [
              "payment_intent",
            ],
          }
        );

      finalPaymentIntent =
        session.payment_intent?.id ||
        session.payment_intent ||
        "";
    }

    if (!finalPaymentIntent) {
      return res.status(400).json({
        ok: false,
        error: "Payment intent not found",
      });
    }

    const refund =
      await stripe.refunds.create({
        payment_intent: finalPaymentIntent,
        reason:
          [
            "duplicate",
            "fraudulent",
            "requested_by_customer",
          ].includes(reason)
            ? reason
            : "requested_by_customer",

        metadata: {
          source: "CHAINVERS",
          reason_detail:
            input.reason_detail ||
            "Dielo bolo medzičasom zakúpené iným používateľom.",
        },
      });

    console.log("[stripeRefund] refund created", {
      refund: refund.id,
      payment_intent: finalPaymentIntent,
      status: refund.status,
    });

    return res.status(200).json({
      ok: true,
      refund_id: refund.id,
      payment_intent: finalPaymentIntent,
      status: refund.status,
    });

  } catch (err) {
    console.error(
      "[stripeRefund] error",
      err?.message || err
    );

    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}

// ======================================================
//  STRIPE: Webhook
// ======================================================
async function stripeWebhook(req, res) {
  const E = readEnv();

  const stripe = new Stripe(E.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });

  const rawBody = await readRaw(req);

  let event;

  try {
    event =
      stripe.webhooks.constructEvent(
        rawBody,
        req.headers["stripe-signature"],
        E.STRIPE_WEBHOOK_SECRET
      );

  } catch (err) {
    console.error(
      "[stripeWebhook] bad signature",
      err?.message
    );

    return res
      .status(400)
      .send(`Webhook Error: ${err.message}`);
  }

  res.status(200).json({
    received: true,
  });

  if (event.type === "checkout.session.completed") {
    const s = event.data.object;

    const meta =
      s.metadata || {};

    const payload = {
      paymentIntentId: s.payment_intent,
      amount: (s.amount_total ?? 0) / 100,
      currency: s.currency?.toUpperCase() ?? "EUR",
      crop_data: safeParseJSON(meta.crop_data),
      user_address: meta.user_address || "unknown",
      status: "paid",
      ts: Date.now(),
    };

    try {
      await fetch(
        `${E.INF_FREE_URL}/accptpay.php`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        }
      );

      console.log(
        "[Webhook → accptpay] Data sent",
        payload
      );

    } catch (err) {
      console.error(
        "[Webhook → accptpay] failed:",
        err.message
      );
    }
  }
}

// ======================================================
//  COINBASE AUTO BUY (volané z accptpay.php)
// ======================================================
async function coinbaseAutoBuy(req, res) {
  try {
    const q =
      req.method === "POST"
        ? await readJson(req)
        : req.query;

    const amountEur =
      Number(q.amount || 0);

    const product =
      String(q.product || "ETH-EUR");

    if (!amountEur || amountEur <= 0) {
      return res.status(400).json({
        error: "Missing or invalid amount",
      });
    }

    console.log(
      `[coinbaseAutoBuy] Spúšťam automatizovaný nákup ${amountEur} € → ${product}`
    );

    const E = readEnv();

    const timestamp =
      Math.floor(Date.now() / 1000);

    const path =
      "/api/v3/brokerage/orders";

    const body = {
      client_order_id: crypto.randomUUID(),

      product_id: product,

      side: "BUY",

      order_configuration: {
        market_market_ioc: {
          quote_size: String(amountEur),
        },
      },
    };

    const bodyStr =
      JSON.stringify(body);

    const prehash =
      timestamp +
      "POST" +
      path +
      bodyStr;

    const signature =
      crypto
        .createHmac(
          "sha256",
          E.COINBASE_API_SECRET
        )
        .update(prehash)
        .digest("base64");

    const headers = {
      "CB-ACCESS-KEY": E.COINBASE_API_KEY,
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
    };

    const url =
      `${E.COINBASE_BASE_URL}${path}`;

    const r =
      await fetch(
        url,
        {
          method: "POST",
          headers,
          body: bodyStr,
        }
      );

    const text =
      await r.text();

    let json = {};

    try {
      json = JSON.parse(text);
    } catch {}

    console.log(
      "[coinbaseAutoBuy] Výsledok:",
      json
    );

    if (!r.ok) {
      return res.status(500).json({
        error: json || text,
      });
    }

    return res.status(200).json({
      ok: true,
      data: json,
    });

  } catch (err) {
    console.error(
      "[coinbaseAutoBuy] error:",
      err
    );

    return res.status(500).json({
      error: err.message,
    });
  }
}

// ======================================================
//  UTIL
// ======================================================
async function readJson(req) {
  if (
    req.body &&
    typeof req.body === "object"
  ) {
    return req.body;
  }

  const raw =
    await readRaw(req);

  try {
    return JSON.parse(
      raw.toString("utf8")
    );

  } catch {
    return {};
  }
}

async function readRaw(req) {
  const chunks = [];

  for await (const ch of req) {
    chunks.push(ch);
  }

  return Buffer.concat(chunks);
}

function safeParseJSON(x) {
  if (!x || typeof x !== "string") {
    return null;
  }

  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

// ======================================================
// MERGED ACTION: MINTCHAIN
// URL: /api/chainvers?action=mintchain
// ======================================================
function mintLog(msg, data = null) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.mintLog(line, data || "");
}

function mintParseErr(e) {
  return (
    e?.data?.message ||
    e?.reason ||
    e?.message ||
    "Unknown error"
  );
}

function mintLoadAbi() {
  const raw =
    process.env.CONTRACT_ABI ||
    process.env.ABI ||
    process.env.CONTRACT_ABI_JSON;

  if (!raw) throw new Error("Missing CONTRACT_ABI env");

  return JSON.parse(raw);
}

function mintExtractTokenIdFromReceipt(web3, receipt, contractAddress) {
  const transferTopic = web3.utils.sha3("Transfer(address,address,uint256)");
  const zeroTopic = "0x" + "0".repeat(64);

  const logs = receipt?.logs || [];

  for (const l of logs) {
    const sameContract =
      String(l.address || "").toLowerCase() === String(contractAddress || "").toLowerCase();

    if (!sameContract) continue;
    if (!l.topics || l.topics[0] !== transferTopic) continue;

    const fromTopic = l.topics[1];

    if (String(fromTopic).toLowerCase() !== zeroTopic.toLowerCase()) continue;

    const tokenTopic = l.topics[3];

    if (!tokenTopic) continue;

    return web3.utils.hexToNumberString(tokenTopic);
  }

  return null;
}

async function mintChainAction(req, res) {
  const logs = [];

  try {
    mintLog("REQUEST_START", { method: req.method });

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        success: false,
        error: "Method not allowed"
      });
    }

    const requestBody = await readJson(req);

    const {
      metadataURI,
      crop_id,
      walletAddress,
      wallet
    } = requestBody || {};

    const toWallet = walletAddress || wallet;

    mintLog("BODY", {
      metadataURI,
      crop_id,
      walletAddress: toWallet
    });

    if (!metadataURI || !crop_id || !toWallet) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Missing metadataURI, crop_id or walletAddress"
      });
    }

    const rpc = process.env.PROVIDER_URL;
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;

    if (!rpc) throw new Error("Missing PROVIDER_URL");
    if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");
    if (!privateKey) throw new Error("Missing PRIVATE_KEY");

    const web3 = new Web3(rpc);
    const abi = mintLoadAbi();

    const account = web3.eth.accounts.privateKeyToAccount(
      privateKey.startsWith("0x") ? privateKey : "0x" + privateKey
    );

    web3.eth.accounts.wallet.add(account);

    const contract = new web3.eth.Contract(abi, contractAddress);

    mintLog("OWNER_WALLET", account.address);

    let mintFee = "0";

    try {
      mintFee = await contract.methods.mintFee().call();
    } catch (e) {
      mintLog("MINT_FEE_READ_FAIL", mintParseErr(e));
    }

    mintLog("MINT_FEE", {
      wei: mintFee,
      eth: web3.utils.fromWei(mintFee, "ether")
    });

    let method;

    if (contract.methods.createOriginal) {
      method = contract.methods.createOriginal(
        metadataURI,
        metadataURI,
        500,
        1000
      );
    } else if (contract.methods.mintOriginal) {
      method = contract.methods.mintOriginal(
        toWallet,
        metadataURI
      );
    } else if (contract.methods.mintNFT) {
      method = contract.methods.mintNFT(
        toWallet,
        metadataURI
      );
    } else {
      throw new Error("ABI neobsahuje createOriginal/mintOriginal/mintNFT");
    }

    const gas = await method.estimateGas({
      from: account.address,
      value: mintFee
    });

    const gasPrice = await web3.eth.getGasPrice();

    mintLog("GAS", {
      gas: gas.toString(),
      gasPrice: gasPrice.toString()
    });

    const tx = {
      from: account.address,
      to: contractAddress,
      data: method.encodeABI(),
      gas: Math.ceil(Number(gas) * 1.25),
      gasPrice,
      value: mintFee
    };

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      account.privateKey
    );

    const receipt = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    const tokenId = mintExtractTokenIdFromReceipt(web3, receipt, contractAddress);

    mintLog("MINT_OK", {
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      tokenId
    });

    if (!tokenId) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Mint OK, but tokenId was not found in Transfer event",
        txHash: receipt.transactionHash,
        contractAddress,
        cropId: crop_id,
        metadataURI
      });
    }

    return res.status(200).json({
      ok: true,
      success: true,
      message: "Mint OK",
      txHash: receipt.transactionHash,
      contractAddress,
      tokenId,
      token_id: tokenId,
      cropId: crop_id,
      crop_id,
      metadataURI,
      openseaUrl: `https://opensea.io/assets/base/${contractAddress}/${tokenId}`
    });

  } catch (e) {
    mintLog("HANDLER_FATAL", mintParseErr(e));

    return res.status(500).json({
      ok: false,
      success: false,
      error: mintParseErr(e),
      stack: e?.stack || null
    });
  }
}

// ======================================================
// MERGED ACTION: GETCHAIN
// URL: /api/chainvers?action=getchain
// Konkrétna Printify operácia zostáva v POST JSON poli action.
// ======================================================
async function getChainAction(req, res) {
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://chainvers.free.nf",
    "http://chainvers.free.nf",
    "https://www.chainvers.free.nf",
    "http://www.chainvers.free.nf"
  ];

  res.setHeader(
    "Access-Control-Allow-Origin",
    allowedOrigins.includes(origin) ? origin : "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { PRINTIFY_API_KEY } = process.env;

  if (!PRINTIFY_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Missing PRINTIFY_API_KEY"
    });
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      version: "chainvers-getchain-full-catalog-images-v2-print-position"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    let body = await readJson(req);

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const action = body.action || "create_product";
    const authHeader = {
      Authorization: `Bearer ${PRINTIFY_API_KEY}`
    };

    async function safeJson(resp) {
      const text = await resp.text();

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        clearTimeout(timer);
        return resp;
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`Fetch failed: ${e.message}`);
      }
    }

    function clampNumber(value, min, max, fallback) {
      const num = Number(value);

      if (!Number.isFinite(num)) return fallback;

      return Math.max(min, Math.min(max, num));
    }

    async function getShopId() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/shops.json",
        { headers: authHeader },
        9000
      );

      const data = await safeJson(resp);
      const shopId = data?.[0]?.id;

      if (!resp.ok || !shopId) {
        throw new Error("Printify shop not found");
      }

      return shopId;
    }

    async function loadBlueprints() {
      const resp = await fetchWithTimeout(
        "https://api.printify.com/v1/catalog/blueprints.json",
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok || !Array.isArray(data)) {
        throw new Error("Printify catalog failed");
      }

      return data;
    }

    async function loadProviders(blueprintId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok || !Array.isArray(data)) {
        throw new Error("Printify providers failed");
      }

      return data;
    }

    async function loadVariants(blueprintId, providerId) {
      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
        { headers: authHeader },
        12000
      );

      const data = await safeJson(resp);

      if (!resp.ok) {
        throw new Error("Printify variants failed");
      }

      return data || {};
    }

    function collectImages(obj, out = []) {
      if (!obj) return out;

      if (typeof obj === "string") {
        const s = obj.trim();

        if (
          s.startsWith("http") &&
          (
            s.includes(".jpg") ||
            s.includes(".jpeg") ||
            s.includes(".png") ||
            s.includes(".webp") ||
            s.includes("printify") ||
            s.includes("mockup") ||
            s.includes("cdn")
          )
        ) {
          out.push(s);
        }

        return out;
      }

      if (Array.isArray(obj)) {
        obj.forEach(x => collectImages(x, out));
        return out;
      }

      if (typeof obj === "object") {
        Object.values(obj).forEach(v => collectImages(v, out));
      }

      return out;
    }

    function unique(arr) {
      return [
        ...new Set(
          (arr || [])
            .map(v => String(v || "").trim())
            .filter(Boolean)
        )
      ];
    }

    function splitVariant(title = "") {
      const parts = String(title)
        .split(/[\/|,]/g)
        .map(v => v.trim())
        .filter(Boolean);

      let size = "";
      let color = "";

      const sizeRe = /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/i;

      for (const p of parts) {
        if (!size && sizeRe.test(p)) {
          size = p;
        }
      }

      for (const p of parts) {
        if (p !== size) {
          color = p;
          break;
        }
      }

      return {
        size: size || parts[parts.length - 1] || "Default",
        color: color || parts[0] || "Default"
      };
    }

    function extractPreview(product) {
      const found = collectImages(product);
      return found[0] || null;
    }

    function frontPlaceholder(printAreas = []) {
      const positions = [];

      for (const area of printAreas || []) {
        for (const p of area?.placeholders || []) {
          if (p?.position) {
            positions.push(String(p.position));
          }
        }
      }

      return (
        positions.find(p => p === "front") ||
        positions.find(p => p.includes("front")) ||
        positions[0] ||
        "front"
      );
    }

    function isBadProduct(title) {
      const t = String(title || "").toLowerCase();

      return (
        t.includes("kid") ||
        t.includes("kids") ||
        t.includes("youth") ||
        t.includes("baby") ||
        t.includes("toddler") ||
        t.includes("pet") ||
        t.includes("dog")
      );
    }

    if (action === "mockchain_catalog") {
      const blueprints = await loadBlueprints();

      const offset = Math.max(0, Number(body.offset || 0));
      const limit = Math.max(1, Math.min(9, Number(body.limit || 9)));

      const products = [];
      let scanned = 0;
      let nextOffset = offset;

      for (let i = offset; i < blueprints.length; i++) {
        nextOffset = i + 1;

        const bp = blueprints[i];
        const title = String(bp.title || "").toLowerCase();

        if (!title.includes("unisex")) continue;
        if (isBadProduct(title)) continue;

        const images = unique(collectImages(bp));
        const thumbnail = images[0] || null;

        products.push({
          key: String(bp.id),
          label: bp.title || `Printify produkt ${bp.id}`,
          blueprint_id: bp.id,
          blueprint_title: bp.title || `Blueprint ${bp.id}`,
          print_provider_id: null,
          print_provider_title: "Printify",
          thumbnail,
          images,
          variants: [],
          sizes: [],
          colors: []
        });

        scanned++;

        if (scanned >= limit) break;
      }

      return res.status(200).json({
        ok: true,
        products,
        count: products.length,
        nextOffset,
        totalBlueprints: blueprints.length
      });
    }

    if (action === "get_variants") {
      try {
        const blueprintId = body.blueprint_id;

        if (!blueprintId) {
          return res.status(200).json({
            ok: true,
            colors: [],
            sizes: [],
            images: [],
            variants: []
          });
        }

        const providers = await loadProviders(blueprintId);
        const provider = providers?.[0];

        if (!provider?.id) {
          return res.status(200).json({
            ok: true,
            colors: [],
            sizes: [],
            images: [],
            variants: []
          });
        }

        const variantsData = await loadVariants(
          blueprintId,
          provider.id
        );

        const variants = Array.isArray(variantsData.variants)
          ? variantsData.variants
          : [];

        const normalized = variants.map(v => {
          const split = splitVariant(v.title || "");

          return {
            id: v.id,
            title: v.title || `Variant ${v.id}`,
            size: split.size,
            color: split.color,
            is_enabled: v.is_enabled !== false,

            // Cena z API
            price: v.price ?? v.cost ?? v.retail_price ?? null
          };
        });

        const images = unique(collectImages(variantsData));

        return res.status(200).json({
          ok: true,
          blueprint_id: blueprintId,
          print_provider_id: provider.id,
          print_provider_title:
            provider.title ||
            provider.name ||
            `Provider ${provider.id}`,
          colors: unique(normalized.map(v => v.color)),
          sizes: unique(normalized.map(v => v.size)),
          images,
          variants: normalized,
          print_areas: variantsData.print_areas || []
        });
      } catch (e) {
        return res.status(200).json({
          ok: true,
          colors: [],
          sizes: [],
          images: [],
          variants: [],
          error: e.message || String(e)
        });
      }
    }

    if (action === "preview_status") {
      const { product_id } = body;

      if (!product_id) {
        return res.status(400).json({
          ok: false,
          error: "Missing product_id"
        });
      }

      const shopId = await getShopId();

      const resp = await fetchWithTimeout(
        `https://api.printify.com/v1/shops/${shopId}/products/${product_id}.json`,
        { headers: authHeader },
        12000
      );

      const product = await safeJson(resp);

      if (!resp.ok || !product?.id) {
        return res.status(500).json({
          ok: false,
          error: "Product fetch failed",
          resp: product
        });
      }

      const preview = extractPreview(product);

      return res.status(200).json({
        ok: true,
        product,
        product_id: product.id,
        preview,
        preview_url: preview,
        images: unique(collectImages(product)),
        mockup_pending: !preview
      });
    }

    const {
      crop_id,
      image_url,
      blueprint_id,
      print_provider_id,
      variant_id,
      product_type,
      size,
      color,

      // hodnoty z prodchain.php
      print_x,
      print_y,
      print_scale,
      print_angle
    } = body;

    if (!crop_id || !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing crop_id or image_url"
      });
    }

    if (!blueprint_id || !print_provider_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing product blueprint or provider"
      });
    }

    const shopId = await getShopId();

    const imageResp = await fetchWithTimeout(
      image_url,
      {},
      10000
    );

    if (!imageResp.ok) {
      return res.status(500).json({
        ok: false,
        error: "Image download failed",
        status: imageResp.status,
        image_url
      });
    }

    const imageBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString("base64");

    const uploadResp = await fetchWithTimeout(
      "https://api.printify.com/v1/uploads/images.json",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          file_name: `${crop_id}.jpg`,
          contents: imageBase64
        })
      },
      20000
    );

    const uploadData = await safeJson(uploadResp);

    if (!uploadResp.ok || !uploadData.id) {
      return res.status(500).json({
        ok: false,
        error: "Upload failed",
        resp: uploadData
      });
    }

    const variantsData = await loadVariants(
      blueprint_id,
      print_provider_id
    );

    const variants = Array.isArray(variantsData.variants)
      ? variantsData.variants
      : [];

    const selectedVariant =
      variants.find(v => String(v.id) === String(variant_id)) ||
      variants[0];

    if (!selectedVariant) {
      return res.status(500).json({
        ok: false,
        error: "No variant found",
        resp: variantsData
      });
    }

    const placeholder = frontPlaceholder(
      variantsData.print_areas || []
    );

    /*
      Hodnoty sa ukladajú z prodchain:
      x/y = pozícia dizajnu
      scale = veľkosť
      angle = otočenie
    */
    const finalPrintX = clampNumber(print_x, 0, 1, 0.5);
    const finalPrintY = clampNumber(print_y, 0, 1, 0.5);
    const finalPrintScale = clampNumber(print_scale, 0.15, 2, 1);
    const finalPrintAngle = clampNumber(print_angle, -30, 30, 0);

    const productPayload = {
      title: `CHAINVERS ${product_type || "Printify produkt"} ${crop_id}`,

      description:
        `CHAINVERS produkt\n\n` +
        `Typ produktu: ${product_type || ""}\n` +
        `Veľkosť: ${size || ""}\n` +
        `Farba: ${color || ""}`,

      blueprint_id: Number(blueprint_id),
      print_provider_id: Number(print_provider_id),

      variants: [
        {
          id: Number(selectedVariant.id),
          price: 2000,
          is_enabled: true
        }
      ],

      print_areas: [
        {
          variant_ids: [Number(selectedVariant.id)],

          placeholders: [
            {
              position: placeholder,

              images: [
                {
                  id: uploadData.id,

                  // presné nastavenie z PRODCHAIN
                  x: finalPrintX,
                  y: finalPrintY,
                  scale: finalPrintScale,
                  angle: finalPrintAngle
                }
              ]
            }
          ]
        }
      ],

      external_id: `chainvers_${crop_id}_${Date.now()}`
    };

    const createResp = await fetchWithTimeout(
      `https://api.printify.com/v1/shops/${shopId}/products.json`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(productPayload)
      },
      22000
    );

    const product = await safeJson(createResp);

    if (!createResp.ok || !product.id) {
      return res.status(500).json({
        ok: false,
        error: "Product creation failed",
        resp: product
      });
    }

    const preview = extractPreview(product);

    return res.status(200).json({
      ok: true,
      product,
      product_id: product.id,
      preview,
      preview_url: preview,
      images: unique(collectImages(product)),
      printify_product_id: product.id,
      printify_status: "product_created",

      selected: {
        blueprint_id,
        print_provider_id,
        variant_id: selectedVariant.id,
        variant_title: selectedVariant.title || null,
        placeholder,

        print_x: finalPrintX,
        print_y: finalPrintY,
        print_scale: finalPrintScale,
        print_angle: finalPrintAngle
      }
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}

// ======================================================
// MERGED ACTION: CREATE WALLET
// URL: /api/chainvers?action=create_wallet
// ======================================================
function setCreateWalletCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://chainvers.free.nf");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function createWalletAction(req, res) {
  setCreateWalletCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    Coinbase.configure({
      apiKeyName: process.env.COINBASE_API_KEY,
      privateKey: process.env.COINBASE_API_SECRET
    });

    const wallet = await Wallet.create({
      networkId: "base-mainnet"
    });

    const address = await wallet.createAddress();

    return res.status(200).json({
      ok: true,
      address: address.getId(),
      network: "base-mainnet",
      provider: "coinbase"
    });

  } catch (e) {
    console.error("CREATE WALLET ERROR:", e);

    if (e?.httpCode === 429 || e?.apiCode === "resource_exhausted") {
      const fallbackWallet = ethers.Wallet.createRandom();

      return res.status(200).json({
        ok: true,
        address: fallbackWallet.address,
        privateKey: fallbackWallet.privateKey,
        mnemonic: fallbackWallet.mnemonic?.phrase || "",
        network: "base-mainnet",
        provider: "local-fallback",
        warning: "Coinbase limit bol prekročený. Bola vytvorená lokálna EVM peňaženka. Recovery phrase a private key si bezpečne ulož."
      });
    }

    return res.status(400).json({
      ok: false,
      error: e?.message || String(e)
    });
  }
}

// ======================================================
// GLOBAL CHAINVERS PLUGIN
// /api/chainvers?action=plugin
// /api/chainvers?action=translate
// /api/chainvers?action=rates
// ======================================================

const CHAINVERS_CLIENT_PLUGIN = "(() => {\n  'use strict';\n\n  if (window.__CHAINVERS_PLUGIN_SETTINGS_V1__) return;\n  window.__CHAINVERS_PLUGIN_SETTINGS_V1__ = true;\n\n  const baseConfig = Object.assign({\n    sourceLanguage: 'sk',\n    defaultCurrency: 'EUR',\n    translate: true,\n    convertCurrency: true,\n    showStatusBar: true,\n    pluginApi: 'https://chainvers.vercel.app/api/chainvers',\n    settingsUrl: '/plugin.php',\n    protectedTerms: [],\n    userContentSelectors: []\n  }, window.CHAINVERS_PLUGIN_CONFIG || {});\n\n  const STORAGE_KEY = 'chainvers_plugin_settings_v1';\n\n  const defaults = {\n    translateEnabled: baseConfig.translate !== false,\n    language: 'auto',\n    currencyEnabled: baseConfig.convertCurrency !== false,\n    currency: 'auto',\n    showStatusBar: baseConfig.showStatusBar !== false\n  };\n\n  function readSettings() {\n    try {\n      return Object.assign(\n        {},\n        defaults,\n        JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')\n      );\n    } catch (_) {\n      return Object.assign({}, defaults);\n    }\n  }\n\n  let settings = readSettings();\n\n  function normalizeLanguage(value) {\n    let code = String(value || '')\n      .trim()\n      .toLowerCase()\n      .replace('_', '-')\n      .split('-')[0];\n\n    if (code === 'cz') code = 'cs';\n    if (code === 'ua') code = 'uk';\n\n    return /^[a-z]{2,3}$/.test(code) ? code : '';\n  }\n\n  function deviceLanguage() {\n    const candidates = [\n      ...(Array.isArray(navigator.languages) ? navigator.languages : []),\n      navigator.language,\n      navigator.userLanguage,\n      Intl.DateTimeFormat().resolvedOptions().locale\n    ];\n\n    for (const candidate of candidates) {\n      const value = normalizeLanguage(candidate);\n      if (value) return value;\n    }\n\n    return normalizeLanguage(baseConfig.sourceLanguage) || 'sk';\n  }\n\n  function currentLanguage() {\n    return settings.language && settings.language !== 'auto'\n      ? normalizeLanguage(settings.language)\n      : deviceLanguage();\n  }\n\n  function deviceCurrency() {\n    const locale = String(\n      navigator.languages?.[0] ||\n      navigator.language ||\n      Intl.DateTimeFormat().resolvedOptions().locale ||\n      ''\n    ).replace('_', '-');\n\n    const region = locale.split('-')[1]?.toUpperCase() || '';\n\n    const byRegion = {\n      US: 'USD',\n      GB: 'GBP',\n      CZ: 'CZK',\n      PL: 'PLN',\n      HU: 'HUF',\n      CH: 'CHF',\n      SE: 'SEK',\n      NO: 'NOK',\n      DK: 'DKK',\n      RO: 'RON',\n      BG: 'BGN',\n      JP: 'JPY',\n      CA: 'CAD',\n      AU: 'AUD'\n    };\n\n    return byRegion[region] || baseConfig.defaultCurrency || 'EUR';\n  }\n\n  function currentCurrency() {\n    return settings.currency && settings.currency !== 'auto'\n      ? String(settings.currency).toUpperCase()\n      : deviceCurrency();\n  }\n\n  const sourceLanguage = normalizeLanguage(baseConfig.sourceLanguage) || 'sk';\n  const targetLanguage = currentLanguage();\n  const targetCurrency = currentCurrency();\n\n  document.documentElement.lang = targetLanguage;\n  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].includes(targetLanguage)\n    ? 'rtl'\n    : 'ltr';\n\n  const excludedSelector = [\n    'script',\n    'style',\n    'noscript',\n    'template',\n    'svg',\n    'canvas',\n    'code',\n    'pre',\n    'textarea',\n    'input[type=\"password\"]',\n    'input[type=\"email\"]',\n    'input[type=\"tel\"]',\n    '[data-no-translate]',\n    '[translate=\"no\"]',\n    '.notranslate',\n    ...(Array.isArray(baseConfig.userContentSelectors)\n      ? baseConfig.userContentSelectors\n      : [])\n  ].filter(Boolean).join(',');\n\n  const protectedTerms = Array.isArray(baseConfig.protectedTerms)\n    ? baseConfig.protectedTerms\n    : [];\n\n  const translatedCache = new Map();\n  const activeNodes = new WeakSet();\n  let observer = null;\n  let observerTimer = null;\n  let ratesPromise = null;\n  let rates = null;\n  let statusBar = null;\n\n  const localDictionary = {\n    en: {\n      'Prihlásenie': 'Login',\n      'Registrovať': 'Register',\n      'Registrácia': 'Registration',\n      'Odhlásiť': 'Log out',\n      'Späť': 'Back',\n      'Galéria': 'Gallery',\n      'Môj profil': 'My profile',\n      'Verejný profil': 'Public profile',\n      'Otvoriť verejný profil autora': 'Open the author’s public profile',\n      'Načítavam': 'Loading',\n      'Načítavam...': 'Loading...',\n      'Uložiť': 'Save',\n      'Zrušiť': 'Cancel',\n      'Pokračovať': 'Continue',\n      'Kúpiť': 'Buy',\n      'Zostatok': 'Balance',\n      'Celkový zostatok': 'Total balance',\n      'Sociálne siete': 'Social networks',\n      'CHAINVERS štatistiky': 'CHAINVERS statistics',\n      'O profile': 'About the profile',\n      'Informácie o vlastníkovi': 'Owner information'\n    },\n    cs: {\n      'Prihlásenie': 'Přihlášení',\n      'Registrovať': 'Registrovat',\n      'Registrácia': 'Registrace',\n      'Odhlásiť': 'Odhlásit',\n      'Späť': 'Zpět',\n      'Galéria': 'Galerie',\n      'Môj profil': 'Můj profil',\n      'Verejný profil': 'Veřejný profil',\n      'Načítavam': 'Načítám',\n      'Načítavam...': 'Načítám...',\n      'Uložiť': 'Uložit',\n      'Zrušiť': 'Zrušit',\n      'Pokračovať': 'Pokračovat',\n      'Kúpiť': 'Koupit',\n      'Zostatok': 'Zůstatek',\n      'Celkový zostatok': 'Celkový zůstatek',\n      'Sociálne siete': 'Sociální sítě'\n    }\n  };\n\n  function isExcluded(node) {\n    const element = node?.nodeType === Node.ELEMENT_NODE\n      ? node\n      : node?.parentElement;\n\n    if (!element) return true;\n\n    try {\n      return Boolean(element.closest(excludedSelector));\n    } catch (_) {\n      return false;\n    }\n  }\n\n  function canTranslate(text) {\n    const value = String(text || '').trim();\n\n    if (value.length < 2) return false;\n    if (!/[\\p{L}]/u.test(value)) return false;\n\n    if (\n      /^(https?:\\/\\/|www\\.|0x[a-f0-9]{8,}|[\\w.+-]+@[\\w.-]+\\.[a-z]{2,})/i\n        .test(value)\n    ) {\n      return false;\n    }\n\n    const lower = value.toLowerCase();\n\n    if (\n      protectedTerms.some(term =>\n        term &&\n        lower.includes(String(term).toLowerCase())\n      ) &&\n      value.split(/\\s+/).length <= 2\n    ) {\n      return false;\n    }\n\n    return true;\n  }\n\n  function createStatusBar() {\n    if (!settings.showStatusBar || statusBar) return;\n\n    const style = document.createElement('style');\n    style.id = 'chainvers-plugin-status-style';\n    style.textContent = `\n      html.chainvers-status-visible body {\n        padding-bottom: calc(27px + env(safe-area-inset-bottom)) !important;\n      }\n      #chainversPluginStatus {\n        position: fixed !important;\n        left: 0 !important;\n        bottom: 0 !important;\n        z-index: 2147483000 !important;\n        width: 100% !important;\n        min-height: 0 !important;\n        box-sizing: border-box !important;\n        display: flex !important;\n        align-items: center !important;\n        justify-content: center !important;\n        gap: 7px !important;\n        margin: 0 !important;\n        padding: 5px max(10px, env(safe-area-inset-right)) calc(5px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)) !important;\n        border-top: 1px solid rgba(255, 225, 92, .62) !important;\n        border-bottom: 1px solid rgba(255, 225, 92, .18) !important;\n        border-left: 0 !important;\n        border-right: 0 !important;\n        border-radius: 0 !important;\n        background: rgba(5, 8, 16, .94) !important;\n        color: rgba(255, 239, 170, .92) !important;\n        box-shadow: none !important;\n        font: 800 10px/1.25 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n        letter-spacing: .02em !important;\n        text-align: center !important;\n        text-decoration: none !important;\n        transform: none !important;\n        backdrop-filter: blur(10px) !important;\n        -webkit-backdrop-filter: blur(10px) !important;\n        transition: opacity .2s ease !important;\n        cursor: pointer !important;\n        pointer-events: auto !important;\n      }\n      #chainversPluginStatus::before {\n        content: \"\" !important;\n        flex: 0 0 auto !important;\n        width: 5px !important;\n        height: 5px !important;\n        border-radius: 50% !important;\n        background: #ffe15c !important;\n        box-shadow: none !important;\n        animation: chainversPluginPulse 1.25s ease-in-out infinite !important;\n      }\n      #chainversPluginStatus.is-ready::before {\n        animation: none !important;\n        background: #58f29a !important;\n      }\n      #chainversPluginStatus.is-hidden {\n        opacity: 0 !important;\n        pointer-events: none !important;\n      }\n      @keyframes chainversPluginPulse {\n        0%, 100% { opacity: .42; }\n        50% { opacity: 1; }\n      }\n      @media (max-width: 480px) {\n        #chainversPluginStatus {\n          width: 100% !important;\n          margin-top: 0 !important;\n          padding: 5px 7px !important;\n          font-size: 9px !important;\n        }\n      }\n    `;\n\n    document.head.appendChild(style);\n\n    statusBar = document.createElement('a');\n    statusBar.id = 'chainversPluginStatus';\n    statusBar.href = baseConfig.settingsUrl || '/plugin.php';\n    statusBar.setAttribute('aria-label', 'CHAINVERS plugin settings');\n    statusBar.textContent = 'Načítavajú sa CHAINVERS pluginy…';\n\n    document.body.appendChild(statusBar);\n    document.documentElement.classList.add('chainvers-status-visible');\n\n  }\n\n  function setStatus(message, ready = false) {\n    if (!statusBar) return;\n\n    statusBar.textContent = message;\n    statusBar.classList.toggle('is-ready', ready);\n  }\n\n  async function apiRequest(params) {\n    const url = new URL(baseConfig.pluginApi);\n\n    Object.entries(params).forEach(([key, value]) => {\n      url.searchParams.set(key, String(value));\n    });\n\n    const response = await fetch(url.toString(), {\n      method: 'GET',\n      mode: 'cors',\n      credentials: 'omit',\n      cache: 'no-store'\n    });\n\n    if (!response.ok) {\n      throw new Error(`HTTP ${response.status}`);\n    }\n\n    return response.json();\n  }\n\n  async function translateText(text) {\n    const value = String(text || '').trim();\n    const key = `${sourceLanguage}>${targetLanguage}:${value}`;\n\n    if (translatedCache.has(key)) {\n      return translatedCache.get(key);\n    }\n\n    const local = localDictionary[targetLanguage]?.[value];\n\n    if (local) {\n      translatedCache.set(key, local);\n      return local;\n    }\n\n    try {\n      const data = await apiRequest({\n        action: 'translate',\n        q: value,\n        source: sourceLanguage,\n        target: targetLanguage\n      });\n\n      const translated = String(data?.translatedText || '').trim() || value;\n      translatedCache.set(key, translated);\n\n      return translated;\n    } catch (_) {\n      translatedCache.set(key, value);\n      return value;\n    }\n  }\n\n  async function translateTextNode(node) {\n    if (\n      !node ||\n      node.nodeType !== Node.TEXT_NODE ||\n      isExcluded(node)\n    ) {\n      return;\n    }\n\n    const original = node.nodeValue || '';\n    const trimmed = original.trim();\n\n    if (!canTranslate(trimmed)) return;\n\n    activeNodes.add(node);\n\n    const leading = original.match(/^\\s*/)?.[0] || '';\n    const trailing = original.match(/\\s*$/)?.[0] || '';\n    const translated = await translateText(trimmed);\n\n    if (\n      document.contains(node) &&\n      node.nodeValue === original &&\n      translated\n    ) {\n      node.nodeValue = leading + translated + trailing;\n    }\n\n    queueMicrotask(() => activeNodes.delete(node));\n  }\n\n  async function translateAttributes(element) {\n    if (\n      !element ||\n      element.nodeType !== Node.ELEMENT_NODE ||\n      isExcluded(element)\n    ) {\n      return;\n    }\n\n    const attrs = ['placeholder', 'title', 'aria-label'];\n\n    if (\n      element.tagName === 'INPUT' &&\n      ['button', 'submit', 'reset'].includes(element.type)\n    ) {\n      attrs.push('value');\n    }\n\n    for (const attr of attrs) {\n      if (!element.hasAttribute(attr)) continue;\n\n      const original = element.getAttribute(attr) || '';\n      if (!canTranslate(original)) continue;\n\n      const translated = await translateText(original);\n\n      if (\n        translated &&\n        element.getAttribute(attr) === original\n      ) {\n        element.setAttribute(attr, translated);\n      }\n    }\n  }\n\n  function collectTextNodes(root) {\n    const nodes = [];\n\n    if (!root || isExcluded(root)) return nodes;\n\n    if (root.nodeType === Node.TEXT_NODE) {\n      if (canTranslate(root.nodeValue)) nodes.push(root);\n      return nodes;\n    }\n\n    const walker = document.createTreeWalker(\n      root,\n      NodeFilter.SHOW_TEXT,\n      {\n        acceptNode(node) {\n          return !isExcluded(node) && canTranslate(node.nodeValue)\n            ? NodeFilter.FILTER_ACCEPT\n            : NodeFilter.FILTER_REJECT;\n        }\n      }\n    );\n\n    while (walker.nextNode()) {\n      nodes.push(walker.currentNode);\n    }\n\n    return nodes;\n  }\n\n  async function translateRoot(root = document.body) {\n    if (\n      !settings.translateEnabled ||\n      targetLanguage === sourceLanguage ||\n      !root\n    ) {\n      return;\n    }\n\n    const nodes = collectTextNodes(root).slice(0, 500);\n\n    for (const node of nodes) {\n      await translateTextNode(node);\n    }\n\n    const elements = root.nodeType === Node.ELEMENT_NODE\n      ? [root, ...root.querySelectorAll('*')]\n      : [];\n\n    for (const element of elements.slice(0, 800)) {\n      await translateAttributes(element);\n    }\n  }\n\n  async function getRates() {\n    if (rates) return rates;\n    if (ratesPromise) return ratesPromise;\n\n    ratesPromise = apiRequest({\n      action: 'rates',\n      base: 'EUR'\n    })\n      .then(data => {\n        rates = Object.assign({ EUR: 1 }, data?.rates || {});\n        return rates;\n      })\n      .catch(() => null)\n      .finally(() => {\n        ratesPromise = null;\n      });\n\n    return ratesPromise;\n  }\n\n  function parseNumber(value) {\n    let normalized = String(value).replace(/\\s/g, '');\n    const lastComma = normalized.lastIndexOf(',');\n    const lastDot = normalized.lastIndexOf('.');\n\n    if (lastComma > lastDot) {\n      normalized = normalized.replace(/\\./g, '').replace(',', '.');\n    } else {\n      normalized = normalized.replace(/,/g, '');\n    }\n\n    return Number(normalized);\n  }\n\n  async function convertCurrencyNode(node) {\n    if (\n      !node ||\n      node.nodeType !== Node.TEXT_NODE ||\n      isExcluded(node)\n    ) {\n      return;\n    }\n\n    const original = node.nodeValue || '';\n    const pattern =\n      /(?:([€$£])\\s*([0-9][0-9\\s.,]*))|(?:([0-9][0-9\\s.,]*)\\s*(EUR|USD|GBP|CZK|Kč|PLN|HUF|CHF|SEK|NOK|DKK|RON|BGN|JPY|CAD|AUD)\\b)/gi;\n\n    if (!pattern.test(original)) return;\n    pattern.lastIndex = 0;\n\n    const exchange = await getRates();\n\n    if (!exchange || !exchange[targetCurrency]) return;\n\n    const currencyMap = {\n      '€': 'EUR',\n      '$': 'USD',\n      '£': 'GBP',\n      'KČ': 'CZK',\n      EUR: 'EUR',\n      USD: 'USD',\n      GBP: 'GBP',\n      CZK: 'CZK',\n      PLN: 'PLN',\n      HUF: 'HUF',\n      CHF: 'CHF',\n      SEK: 'SEK',\n      NOK: 'NOK',\n      DKK: 'DKK',\n      RON: 'RON',\n      BGN: 'BGN',\n      JPY: 'JPY',\n      CAD: 'CAD',\n      AUD: 'AUD'\n    };\n\n    const replaced = original.replace(\n      pattern,\n      (full, symbol, numberOne, numberTwo, code) => {\n        const source = currencyMap[\n          String(symbol || code || '').toUpperCase()\n        ];\n\n        const amount = parseNumber(numberOne || numberTwo);\n\n        if (\n          !source ||\n          !Number.isFinite(amount) ||\n          !exchange[source] ||\n          source === targetCurrency\n        ) {\n          return full;\n        }\n\n        const converted =\n          (amount / exchange[source]) *\n          exchange[targetCurrency];\n\n        try {\n          return new Intl.NumberFormat(\n            navigator.languages?.[0] ||\n            navigator.language ||\n            'sk-SK',\n            {\n              style: 'currency',\n              currency: targetCurrency,\n              maximumFractionDigits: 2\n            }\n          ).format(converted);\n        } catch (_) {\n          return `${converted.toFixed(2)} ${targetCurrency}`;\n        }\n      }\n    );\n\n    if (replaced !== original) {\n      node.nodeValue = replaced;\n    }\n  }\n\n  async function convertRoot(root = document.body) {\n    if (!settings.currencyEnabled || !root) return;\n\n    const nodes = collectTextNodes(root).slice(0, 700);\n\n    for (const node of nodes) {\n      await convertCurrencyNode(node);\n    }\n  }\n\n  async function processRoot(root) {\n    await translateRoot(root);\n    await convertRoot(root);\n  }\n\n  function scheduleProcess(root) {\n    clearTimeout(observerTimer);\n\n    observerTimer = setTimeout(() => {\n      processRoot(root || document.body);\n    }, 140);\n  }\n\n  function startObserver() {\n    if (observer || !document.body) return;\n\n    observer = new MutationObserver(mutations => {\n      let root = null;\n\n      for (const mutation of mutations) {\n        if (\n          mutation.type === 'characterData' &&\n          activeNodes.has(mutation.target)\n        ) {\n          continue;\n        }\n\n        if (mutation.type === 'characterData') {\n          root = mutation.target.parentElement || root;\n        }\n\n        for (const node of mutation.addedNodes) {\n          if (\n            node.nodeType === Node.ELEMENT_NODE ||\n            node.nodeType === Node.TEXT_NODE\n          ) {\n            root = node.nodeType === Node.ELEMENT_NODE\n              ? node\n              : node.parentElement;\n          }\n        }\n      }\n\n      if (root) scheduleProcess(root);\n    });\n\n    observer.observe(document.body, {\n      subtree: true,\n      childList: true,\n      characterData: true\n    });\n  }\n\n  async function init() {\n    createStatusBar();\n\n    setStatus('Rozpoznávam jazyk a región zariadenia…');\n\n    await new Promise(resolve => setTimeout(resolve, 180));\n\n    if (settings.translateEnabled && targetLanguage !== sourceLanguage) {\n      setStatus(`Prekladám CHAINVERS do jazyka ${targetLanguage.toUpperCase()}…`);\n    } else if (!settings.translateEnabled) {\n      setStatus('Automatický preklad je vypnutý.');\n    } else {\n      setStatus('Jazyk CHAINVERS zodpovedá zariadeniu.');\n    }\n\n    await translateRoot(document.body);\n\n    if (settings.currencyEnabled) {\n      setStatus(`Prispôsobujem menu na ${targetCurrency}…`);\n      await convertRoot(document.body);\n    }\n\n    startObserver();\n\n    document.documentElement.dataset.chainversPlugin = 'ready';\n    document.documentElement.dataset.chainversLanguage = targetLanguage;\n    document.documentElement.dataset.chainversCurrency = targetCurrency;\n\n    setStatus('CHAINVERS je pripravený ✓', true);\n\n    window.dispatchEvent(\n      new CustomEvent('chainvers:plugin-ready', {\n        detail: {\n          language: targetLanguage,\n          sourceLanguage,\n          currency: targetCurrency,\n          settings\n        }\n      })\n    );\n  }\n\n  window.addEventListener('chainvers:settings-saved', event => {\n    try {\n      const next = Object.assign({}, defaults, event.detail || {});\n      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));\n    } catch (_) {}\n  });\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', init, { once: true });\n  } else {\n    init();\n  }\n})();";

function chainversPluginScript(req, res) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=300, stale-while-revalidate=86400"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(CHAINVERS_CLIENT_PLUGIN);
}

async function chainversTranslate(req, res) {
  const q = String(req.query?.q || "").trim();
  const source = String(req.query?.source || "sk").trim().toLowerCase();
  const target = String(req.query?.target || "").trim().toLowerCase();

  if (!q || !target || q.length > 900) {
    return res.status(400).json({
      ok: false,
      error: "bad_request",
    });
  }

  if (source === target) {
    return res.status(200).json({
      ok: true,
      translatedText: q,
    });
  }

  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", q);
    url.searchParams.set("langpair", `${source}|${target}`);

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "CHAINVERS/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const translatedText = String(
      data?.responseData?.translatedText || ""
    ).trim();

    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=86400"
    );

    return res.status(200).json({
      ok: true,
      translatedText:
        translatedText &&
        !/MYMEMORY WARNING/i.test(translatedText)
          ? translatedText
          : q,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "translation_failed",
    });
  }
}

async function chainversRates(req, res) {
  try {
    const response = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=EUR"
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    res.setHeader(
      "Cache-Control",
      "public, max-age=900, s-maxage=21600"
    );

    return res.status(200).json({
      ok: true,
      base: "EUR",
      rates: data?.rates || {},
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "rates_failed",
    });
  }
}

