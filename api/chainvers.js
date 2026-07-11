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
