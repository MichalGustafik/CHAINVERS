import { rejectChainversDemo } from '../chainvers_demo_guard.js';
console.log("=== BOOT: CHAINVERS chaingetcashdraw.js TOKEN-SAFE WITHDRAW ===");

import Web3 from "web3";

export const maxDuration = 60;

const ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
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
    name: "backendWithdrawToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

function cleanPk(pk) {
  const value = String(pk || "").trim();
  return value.startsWith("0x") ? value : "0x" + value;
}

function lower(v) {
  return String(v || "").trim().toLowerCase();
}

function toWeiSafe(web3, eth) {
  const value = String(eth ?? "").replace(",", ".").trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  try {
    const wei = web3.utils.toWei(value, "ether");
    return BigInt(wei) > 0n ? wei : null;
  } catch {
    return null;
  }
}

async function sendMethod(web3, account, pk, contractAddress, method) {
  const gasPrice = await web3.eth.getGasPrice();
  const estimated = await method.estimateGas({ from: account.address });
  const gas = Math.ceil(Number(estimated) * 1.25);
  const nonce = await web3.eth.getTransactionCount(account.address, "pending");
  const signed = await web3.eth.accounts.signTransaction({
    from: account.address,
    to: contractAddress,
    data: method.encodeABI(),
    gas,
    gasPrice,
    nonce,
    chainId: 8453
  }, pk);
  return await web3.eth.sendSignedTransaction(signed.rawTransaction);
}

export default async function handler(req, res) {
  if (rejectChainversDemo(req, res)) return;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const action = String(body.action || "withdraw").toLowerCase();

    if (!process.env.PROVIDER_URL) return res.status(500).json({ ok:false, error:"missing_PROVIDER_URL" });
    if (!process.env.CONTRACT_ADDRESS) return res.status(500).json({ ok:false, error:"missing_CONTRACT_ADDRESS" });
    if (!process.env.PRIVATE_KEY) return res.status(500).json({ ok:false, error:"missing_PRIVATE_KEY" });

    const web3 = new Web3(process.env.PROVIDER_URL);
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const pk = cleanPk(process.env.PRIVATE_KEY);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);
    const contract = new web3.eth.Contract(ABI, contractAddress);

    if (action === "balances") {
      const rawIds = Array.isArray(body.token_ids) ? body.token_ids : [];
      const tokenIds = [...new Set(rawIds.map(v => String(v || "").trim()).filter(v => /^\d+$/.test(v) && Number(v) > 0))].slice(0, 100);
      const balances = {};

      for (const id of tokenIds) {
        try {
          const [available, owner, isOriginal] = await Promise.all([
            contract.methods.tokenAvailableForWithdraw(id).call(),
            contract.methods.ownerOf(id).call(),
            contract.methods.isOriginalToken(id).call()
          ]);
          balances[id] = {
            ok: true,
            available_wei: String(available),
            available_eth: web3.utils.fromWei(String(available), "ether"),
            owner: String(owner),
            token_type: isOriginal ? "origin" : "copy"
          };
        } catch (e) {
          balances[id] = { ok: false, error: e.message || String(e) };
        }
      }

      return res.json({ ok: true, action: "balances", balances });
    }

    if (action === "balance") {
      const tokenId = String(body.token_id || "").trim();
      if (!/^\d+$/.test(tokenId) || Number(tokenId) <= 0) {
        return res.status(400).json({ ok:false, error:"bad_token_id" });
      }
      const [available, owner, isOriginal] = await Promise.all([
        contract.methods.tokenAvailableForWithdraw(tokenId).call(),
        contract.methods.ownerOf(tokenId).call(),
        contract.methods.isOriginalToken(tokenId).call()
      ]);
      return res.json({
        ok: true,
        action: "balance",
        token_id: tokenId,
        available_wei: String(available),
        available_eth: web3.utils.fromWei(String(available), "ether"),
        owner: String(owner),
        token_type: isOriginal ? "origin" : "copy"
      });
    }

    if (action === "initialize") {
      return res.status(400).json({ ok:false, error:"initialize_disabled" });
    }

    const user = lower(body.user);
    const withdrawTo = lower(body.withdraw_to || user);
    const tokenId = String(body.token_id || "").trim();
    const amountWei = toWeiSafe(web3, body.amount);

    if (!web3.utils.isAddress(user) || !web3.utils.isAddress(withdrawTo)) {
      return res.status(400).json({ ok:false, error:"bad_withdraw_to" });
    }
    if (user !== withdrawTo) {
      return res.status(400).json({ ok:false, error:"withdraw_to_must_equal_user" });
    }
    if (!/^\d+$/.test(tokenId) || Number(tokenId) <= 0) {
      return res.status(400).json({ ok:false, error:"bad_token_id" });
    }
    if (!amountWei) {
      return res.status(400).json({ ok:false, error:"bad_amount" });
    }

    const [owner, available] = await Promise.all([
      contract.methods.ownerOf(tokenId).call(),
      contract.methods.tokenAvailableForWithdraw(tokenId).call()
    ]);

    if (lower(owner) !== user) {
      return res.status(403).json({
        ok:false,
        error:"not_token_owner",
        owner: String(owner),
        user
      });
    }

    if (BigInt(available) < BigInt(amountWei)) {
      return res.status(400).json({
        ok:false,
        error:"exceeds_onchain_balance",
        available_eth: web3.utils.fromWei(String(available), "ether")
      });
    }

    const contractNative = await web3.eth.getBalance(contractAddress);
    if (BigInt(contractNative) < BigInt(amountWei)) {
      return res.status(400).json({
        ok:false,
        error:"contract_native_balance_too_low",
        contract_balance_eth: web3.utils.fromWei(contractNative, "ether")
      });
    }

    const method = contract.methods.backendWithdrawToken(tokenId, withdrawTo, amountWei);
    const sent = await sendMethod(web3, account, pk, contractAddress, method);
    const remaining = await contract.methods.tokenAvailableForWithdraw(tokenId).call();

    return res.json({
      ok: true,
      action: "withdraw",
      tx: sent.transactionHash,
      token_id: tokenId,
      withdraw_to: withdrawTo,
      amount_eth: web3.utils.fromWei(amountWei, "ether"),
      remaining_eth: web3.utils.fromWei(String(remaining), "ether")
    });
  } catch (e) {
    console.error("chaingetcashdraw error", e);
    return res.status(500).json({ ok:false, error:"handler_error", detail:e.message || String(e) });
  }
}
