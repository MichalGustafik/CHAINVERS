import { rejectChainversDemo } from '../chainvers_demo_guard.js';
// ============================================
// FILE: /api/copymint.js
// CHAINVERS CopyMint API
// - robust NFT metadata/image fallback
// - CopyMint event -> real copy token id
// - balance mint debits real on-chain token balances
// - new copies are transferred to the real user wallet
// - copy withdrawals are token-balance aware
// ============================================

import Web3 from "web3";

export const maxDuration = 60;

const COPY_MINTED_EVENT = {
  anonymous: false,
  inputs: [
    { indexed: true,  internalType: "uint256", name: "copyId",     type: "uint256" },
    { indexed: true,  internalType: "uint256", name: "originalId", type: "uint256" },
    { indexed: true,  internalType: "address", name: "owner",      type: "address" },
    { indexed: false, internalType: "uint256", name: "fee",        type: "uint256" }
  ],
  name: "CopyMinted",
  type: "event"
};

const ABI = [
  {
    inputs: [{ internalType: "uint256", name: "originalId", type: "uint256" }],
    name: "mintCopy",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "mintFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "ecoModel",
    outputs: [
      { internalType: "uint96", name: "o", type: "uint96" },
      { internalType: "uint96", name: "t", type: "uint96" },
      { internalType: "uint96", name: "c", type: "uint96" },
      { internalType: "bool", name: "custom", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "tokenAvailableForWithdraw",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "isOriginalToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "adminWithdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "backendWithdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "from", type: "address" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" }
    ],
    name: "safeTransferFrom",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "uint256", name: "amt", type: "uint256" }
    ],
    name: "backendCreditOrigin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "id", type: "uint256" },
      { internalType: "uint256", name: "amt", type: "uint256" }
    ],
    name: "backendCreditCopy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  COPY_MINTED_EVENT
];

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function cleanPrivateKey(pk) {
  if (!pk) return "";
  const value = String(pk).trim();
  return value.startsWith("0x") ? value : "0x" + value;
}

function lower(v) {
  return String(v || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function decodeDataJson(uri) {
  const value = String(uri || "").trim();
  if (!/^data:application\/json/i.test(value)) return null;

  try {
    const comma = value.indexOf(",");
    if (comma < 0) return null;
    const header = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    const text = /;base64/i.test(header)
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resourceCandidates(uri, baseUrl = "") {
  const raw = String(uri || "").trim();
  if (!raw) return [];

  if (/^data:/i.test(raw) || /^blob:/i.test(raw)) return [raw];

  if (/^ar:\/\//i.test(raw)) {
    return ["https://arweave.net/" + raw.replace(/^ar:\/\//i, "")];
  }

  if (/^ipfs:\/\//i.test(raw)) {
    const cidPath = raw.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
    return unique([
      `https://gateway.pinata.cloud/ipfs/${cidPath}`,
      `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
      `https://ipfs.io/ipfs/${cidPath}`
    ]);
  }

  if (/^https?:\/\//i.test(raw)) {
    const out = [raw];
    try {
      const u = new URL(raw);
      const marker = "/ipfs/";
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        const cidPath = u.pathname.slice(idx + marker.length) + u.search;
        out.push(
          `https://gateway.pinata.cloud/ipfs/${cidPath}`,
          `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
          `https://ipfs.io/ipfs/${cidPath}`
        );
      }
    } catch {}
    return unique(out);
  }

  if (baseUrl && /^https?:\/\//i.test(baseUrl)) {
    try {
      return [new URL(raw, baseUrl).toString()];
    } catch {}
  }

  return [raw];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMetadata(uri) {
  const inline = decodeDataJson(uri);
  if (inline) {
    return { metadata: inline, metadataUrl: String(uri || ""), tried: [String(uri || "")] };
  }

  const tried = [];
  for (const url of resourceCandidates(uri)) {
    if (!/^https?:\/\//i.test(url)) continue;
    tried.push(url);
    try {
      const r = await fetchWithTimeout(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "CHAINVERS/1.0"
        },
        cache: "no-store"
      });
      if (!r.ok) continue;
      const text = await r.text();
      try {
        return { metadata: JSON.parse(text), metadataUrl: url, tried };
      } catch {
        continue;
      }
    } catch {}
  }

  return { metadata: null, metadataUrl: "", tried };
}

function collectImageValues(metadata) {
  if (!metadata || typeof metadata !== "object") return [];

  const values = [];
  const add = value => {
    if (typeof value === "string" && value.trim()) values.push(value.trim());
  };

  add(metadata.image);
  add(metadata.image_url);
  add(metadata.imageUrl);
  add(metadata.imageURI);
  add(metadata.image_uri);
  add(metadata.animation_url);
  add(metadata.animationUrl);
  add(metadata.thumbnail);
  add(metadata.thumbnail_url);
  add(metadata?.properties?.image);
  add(metadata?.properties?.image_url);
  add(metadata?.properties?.files?.[0]?.uri);
  add(metadata?.properties?.files?.[0]?.url);
  add(metadata?.media?.[0]?.uri);
  add(metadata?.media?.[0]?.url);
  add(metadata?.files?.[0]?.uri);
  add(metadata?.files?.[0]?.url);

  return unique(values);
}

function imageCandidatesFromMetadata(metadata, metadataUrl = "") {
  const out = [];
  for (const value of collectImageValues(metadata)) {
    out.push(...resourceCandidates(value, metadataUrl));
  }
  return unique(out);
}

async function readEconomics(contract, originalId) {
  const fallback = { origin_percent: 80, treasury_percent: 15, copy_percent: 5, custom: false };
  if (!originalId) return fallback;
  try {
    const m = await contract.methods.ecoModel(originalId).call();
    const custom = Boolean(m.custom ?? m[3]);
    if (!custom) return fallback;
    const origin = Number(m.o ?? m[0]);
    const treasury = Number(m.t ?? m[1]);
    const copy = Number(m.c ?? m[2]);
    if (![origin, treasury, copy].every(Number.isFinite) || origin + treasury + copy !== 100) return fallback;
    return { origin_percent: origin, treasury_percent: treasury, copy_percent: copy, custom: true };
  } catch {
    return fallback;
  }
}

function decodeCopyMinted(web3, receipt, contractAddress) {
  if (!receipt || !Array.isArray(receipt.logs)) return null;
  const signature = lower(web3.eth.abi.encodeEventSignature(COPY_MINTED_EVENT));

  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(contractAddress)) continue;
    if (!log.topics || lower(log.topics[0]) !== signature) continue;

    try {
      const decoded = web3.eth.abi.decodeLog(
        COPY_MINTED_EVENT.inputs,
        log.data || "0x",
        log.topics.slice(1)
      );
      return {
        copyId: String(decoded.copyId),
        originalId: String(decoded.originalId),
        owner: String(decoded.owner),
        feeWei: String(decoded.fee)
      };
    } catch {}
  }

  return null;
}

async function sendMethod(web3, account, pk, contractAddress, method, value = "0") {
  const gasPrice = await web3.eth.getGasPrice();
  const estimated = await method.estimateGas({ from: account.address, value });
  const gas = Math.ceil(Number(estimated) * 1.25);
  const nonce = await web3.eth.getTransactionCount(account.address, "pending");
  const signed = await web3.eth.accounts.signTransaction({
    from: account.address,
    to: contractAddress,
    data: method.encodeABI(),
    value,
    gas,
    gasPrice,
    nonce,
    chainId: 8453
  }, pk);
  return await web3.eth.sendSignedTransaction(signed.rawTransaction);
}

async function sendNative(web3, account, pk, to, valueWei) {
  const gasPrice = await web3.eth.getGasPrice();
  const nonce = await web3.eth.getTransactionCount(account.address, "pending");
  const signed = await web3.eth.accounts.signTransaction({
    from: account.address,
    to,
    value: String(valueWei),
    gas: 50000,
    gasPrice,
    nonce,
    chainId: 8453
  }, pk);
  return await web3.eth.sendSignedTransaction(signed.rawTransaction);
}

async function validateSpendPlan(web3, contract, userAddress, rawPlan, mintFeeWei) {
  if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
    throw new Error("Missing spend_plan");
  }

  const plan = [];
  let total = 0n;

  for (const raw of rawPlan) {
    const tokenId = String(raw?.token_id || raw?.tokenId || "").trim();
    const amountEth = String(raw?.amount_eth || raw?.amount || "").replace(",", ".").trim();

    if (!/^\d+$/.test(tokenId) || Number(tokenId) <= 0) {
      throw new Error("Invalid spend token id");
    }

    let amountWei;
    try {
      amountWei = web3.utils.toWei(amountEth, "ether");
    } catch {
      throw new Error("Invalid spend amount");
    }

    if (BigInt(amountWei) <= 0n) throw new Error("Invalid spend amount");

    const owner = await contract.methods.ownerOf(tokenId).call();
    if (lower(owner) !== lower(userAddress)) {
      throw new Error(`Spend token ${tokenId} is not owned by user`);
    }

    const available = await contract.methods.tokenAvailableForWithdraw(tokenId).call();
    if (BigInt(available) < BigInt(amountWei)) {
      throw new Error(`Spend token ${tokenId} has insufficient on-chain balance`);
    }

    const isOriginal = await contract.methods.isOriginalToken(tokenId).call();
    plan.push({ tokenId, amountWei: String(amountWei), amountEth, isOriginal: !!isOriginal });
    total += BigInt(amountWei);
  }

  if (total !== BigInt(mintFeeWei)) {
    throw new Error(`Spend plan total ${total} != mint fee ${mintFeeWei}`);
  }

  return plan;
}

async function refundDebits(web3, contract, account, pk, contractAddress, completed) {
  if (!completed.length) return [];

  const total = completed.reduce((sum, item) => sum + BigInt(item.amountWei), 0n);
  const logs = [];

  await sendNative(web3, account, pk, contractAddress, total.toString());

  for (const item of completed) {
    const method = item.isOriginal
      ? contract.methods.backendCreditOrigin(item.tokenId, item.amountWei)
      : contract.methods.backendCreditCopy(item.tokenId, item.amountWei);
    const receipt = await sendMethod(web3, account, pk, contractAddress, method);
    logs.push({ token_id: item.tokenId, tx: receipt.transactionHash });
  }

  return logs;
}

export default async function handler(req, res) {
  if (rejectChainversDemo(req, res)) return;
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, endpoint: "copymint", status: "alive" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const originalId = String(body.original_id || "").trim();
    const userAddress = String(body.user_address || body.wallet || "").trim();
    const withdrawTo = String(body.withdraw_to || userAddress || "").trim();
    const tokenId = String(body.token_id || "").trim();
    const txHash = String(body.tx_hash || "").trim();

    if (!action) return res.status(400).json({ ok: false, error: "Missing action" });

    const rpc = process.env.PROVIDER_URL;
    const pk = cleanPrivateKey(process.env.PRIVATE_KEY);
    const contractAddress = process.env.CONTRACT_ADDRESS;

    if (!rpc) return res.status(500).json({ ok: false, error: "Missing PROVIDER_URL" });
    if (!contractAddress) return res.status(500).json({ ok: false, error: "Missing CONTRACT_ADDRESS" });
    if (!pk) return res.status(500).json({ ok: false, error: "Missing PRIVATE_KEY" });

    const web3 = new Web3(rpc);
    const contract = new web3.eth.Contract(ABI, contractAddress);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);

    if (action === "scan_preview") {
      const id = tokenId || originalId;
      if (!/^\d+$/.test(id)) {
        return res.status(400).json({ ok: false, error: "Missing token_id" });
      }

      const tokenUri = await contract.methods.tokenURI(id).call();
      const fetched = await fetchMetadata(tokenUri);
      const imageCandidates = imageCandidatesFromMetadata(fetched.metadata, fetched.metadataUrl);

      return res.status(200).json({
        ok: true,
        action: "scan_preview",
        token_id: String(id),
        token_uri: tokenUri,
        metadata_url: fetched.metadataUrl,
        metadata_tried: fetched.tried,
        image: imageCandidates[0] || "",
        image_candidates: imageCandidates,
        metadata: fetched.metadata
      });
    }

    let mintFeeWei = "0";
    try {
      mintFeeWei = String(await contract.methods.mintFee().call());
    } catch {
      mintFeeWei = web3.utils.toWei("0.0002", "ether");
    }

    if (action === "wallet_prepare") {
      if (!originalId || !userAddress) {
        return res.status(400).json({ ok: false, error: "Missing original_id or user_address" });
      }
      const economics = await readEconomics(contract, originalId);
      return res.json({
        ok: true,
        action: "wallet_prepare",
        contract_address: contractAddress,
        original_id: originalId,
        user_address: userAddress,
        mint_fee_wei: mintFeeWei,
        mint_fee_eth: web3.utils.fromWei(mintFeeWei, "ether"),
        economics
      });
    }

    if (action === "verify_mint" || action === "resolve_copy") {
      if (!txHash) return res.status(400).json({ ok: false, error: "Missing tx_hash" });

      const receipt = await web3.eth.getTransactionReceipt(txHash);
      if (!receipt || receipt.status === false) {
        return res.status(400).json({ ok: false, error: "Transaction not confirmed" });
      }
      if (lower(receipt.to) !== lower(contractAddress)) {
        return res.status(400).json({ ok: false, error: "Transaction target is not CHAINVERS contract" });
      }

      const event = decodeCopyMinted(web3, receipt, contractAddress);
      if (!event) return res.status(400).json({ ok: false, error: "CopyMinted event not found" });

      if (originalId && String(event.originalId) !== String(originalId)) {
        return res.status(400).json({ ok: false, error: "Original id does not match transaction" });
      }
      if (userAddress && lower(event.owner) !== lower(userAddress)) {
        return res.status(400).json({ ok: false, error: "Mint owner does not match user" });
      }

      let currentOwner = "";
      try { currentOwner = await contract.methods.ownerOf(event.copyId).call(); } catch {}
      const economics = await readEconomics(contract, event.originalId);

      return res.json({
        ok: true,
        action,
        tx: txHash,
        copy_token_id: event.copyId,
        original_id: event.originalId,
        mint_owner: event.owner,
        current_owner: currentOwner,
        fee_wei: event.feeWei,
        fee_eth: web3.utils.fromWei(event.feeWei, "ether"),
        economics
      });
    }

    if (action === "mint_from_balance") {
      if (!originalId || !userAddress || !web3.utils.isAddress(userAddress)) {
        return res.status(400).json({ ok: false, error: "Missing/invalid original_id or user_address" });
      }

      const spendPlan = await validateSpendPlan(
        web3,
        contract,
        userAddress,
        body.spend_plan,
        mintFeeWei
      );

      const completedDebits = [];
      let mintReceipt = null;

      try {
        for (const item of spendPlan) {
          const method = contract.methods.adminWithdrawToken(
            item.tokenId,
            account.address,
            item.amountWei
          );
          const receipt = await sendMethod(web3, account, pk, contractAddress, method);
          completedDebits.push({ ...item, tx: receipt.transactionHash });
        }

        const txCall = contract.methods.mintCopy(originalId);
        mintReceipt = await sendMethod(web3, account, pk, contractAddress, txCall, mintFeeWei);
      } catch (error) {
        let refund = [];
        let refundError = "";
        if (!mintReceipt && completedDebits.length) {
          try {
            refund = await refundDebits(web3, contract, account, pk, contractAddress, completedDebits);
          } catch (e) {
            refundError = e.message || String(e);
          }
        }

        return res.status(500).json({
          ok: false,
          error: error.message || String(error),
          debits: completedDebits,
          refunded: refund,
          refund_error: refundError
        });
      }

      const event = decodeCopyMinted(web3, mintReceipt, contractAddress);
      if (!event) {
        return res.status(500).json({
          ok: false,
          error: "Mint succeeded but CopyMinted event was not decoded",
          tx: mintReceipt.transactionHash,
          debits: completedDebits
        });
      }

      let transferTx = "";
      let transferOk = false;
      let transferError = "";

      for (let attempt = 0; attempt < 3 && !transferOk; attempt++) {
        try {
          const currentOwner = await contract.methods.ownerOf(event.copyId).call();
          if (lower(currentOwner) === lower(userAddress)) {
            transferOk = true;
            break;
          }
          if (lower(currentOwner) !== lower(account.address)) {
            transferError = `Unexpected CopyMint owner: ${currentOwner}`;
            break;
          }
          const transfer = contract.methods.safeTransferFrom(account.address, userAddress, event.copyId);
          const transferReceipt = await sendMethod(web3, account, pk, contractAddress, transfer);
          transferTx = transferReceipt.transactionHash;
          transferOk = true;
        } catch (e) {
          transferError = e.message || String(e);
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700));
        }
      }

      const economics = await readEconomics(contract, originalId);
      return res.json({
        ok: true,
        action: "mint_from_balance",
        tx: mintReceipt.transactionHash,
        original_id: originalId,
        user_address: userAddress,
        backend_address: account.address,
        mint_fee_wei: mintFeeWei,
        mint_fee_eth: web3.utils.fromWei(mintFeeWei, "ether"),
        copy_token_id: event.copyId,
        mint_owner: event.owner,
        transfer_ok: transferOk,
        transfer_tx: transferTx,
        transfer_error: transferError,
        economics,
        spend_txs: completedDebits.map(item => ({
          token_id: item.tokenId,
          amount_eth: item.amountEth,
          tx: item.tx
        }))
      });
    }

    if (action === "copy_withdraw") {
      if (!tokenId || !userAddress || !withdrawTo || !body.amount_eth) {
        return res.status(400).json({
          ok: false,
          error: "Missing token_id, user_address, withdraw_to or amount_eth"
        });
      }
      if (!web3.utils.isAddress(userAddress) || !web3.utils.isAddress(withdrawTo)) {
        return res.status(400).json({ ok: false, error: "Invalid address" });
      }
      if (lower(userAddress) !== lower(withdrawTo)) {
        return res.status(400).json({ ok: false, error: "Withdraw address must equal user address" });
      }

      const owner = await contract.methods.ownerOf(tokenId).call();
      if (lower(owner) !== lower(userAddress)) {
        return res.status(403).json({ ok: false, error: "User is not on-chain owner of this CopyMint" });
      }

      const amountEth = String(body.amount_eth).replace(",", ".").trim();
      const amountWei = web3.utils.toWei(amountEth, "ether");
      const available = await contract.methods.tokenAvailableForWithdraw(tokenId).call();

      if (BigInt(amountWei) <= 0n) {
        return res.status(400).json({ ok: false, error: "Invalid withdraw amount" });
      }
      if (BigInt(available) < BigInt(amountWei)) {
        return res.status(400).json({
          ok: false,
          error: "Amount exceeds token balance",
          available_eth: web3.utils.fromWei(available, "ether")
        });
      }

      const method = contract.methods.backendWithdrawToken(tokenId, withdrawTo, amountWei);
      const sent = await sendMethod(web3, account, pk, contractAddress, method);
      const remaining = await contract.methods.tokenAvailableForWithdraw(tokenId).call();

      return res.json({
        ok: true,
        action: "copy_withdraw",
        tx: sent.transactionHash,
        token_id: tokenId,
        withdraw_to: withdrawTo,
        amount_eth: amountEth,
        remaining_eth: web3.utils.fromWei(remaining, "ether")
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (e) {
    console.error("COPYMINT API ERROR", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
