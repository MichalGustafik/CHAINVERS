console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (FINAL LIVE INTERNAL) ===");

import Web3 from "web3";

export const maxDuration = 60;

/* ============================================================
   SAFE BODY PARSER
============================================================ */
async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (e) {
        console.log("[BODY PARSE FAIL]", raw);
        resolve({});
      }
    });
  });
}

/* ============================================================
   LOG COLLECTOR
============================================================ */
function mkLog() {
  const rows = [];
  function push(...args) {
    const line = args.map(v => {
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    }).join(" ");
    const msg = `[${new Date().toISOString()}] ${line}`;
    rows.push(msg);
    console.log(msg);
  }
  return { push, rows };
}

/* ============================================================
   RPC FALLBACK
============================================================ */
const RPCS = [
  process.env.PROVIDER_URL,
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://rpc.ankr.com/base"
].filter(Boolean);

async function initWeb3(log) {
  for (const r of RPCS) {
    try {
      const w = new Web3(r);
      const bn = await w.eth.getBlockNumber();
      log.push("[RPC OK]", r, "BLOCK", bn);
      return w;
    } catch (e) {
      log.push("[RPC FAIL]", r, e.message || String(e));
    }
  }
  throw new Error("NO_RPC_AVAILABLE");
}

/* ============================================================
   ABI – BACKEND WITHDRAW ONLY
============================================================ */
const ABI = [{
  inputs: [
    { internalType: "address", name: "to", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" }
  ],
  name: "backendWithdraw",
  outputs: [],
  stateMutability: "nonpayable",
  type: "function"
}];

/* ============================================================
   HELPERS
============================================================ */
function normalizeUser(u) {
  return String(u || "").trim().toLowerCase();
}

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();

  const log = mkLog();
  log.push("=== API CALL: chaingetcashdraw ===");
  log.push("[METHOD]", req.method);

  try {
    const body = await parseBody(req);

    log.push("[BODY]", body);

    const user = normalizeUser(body.user);
    const withdrawTo = normalizeUser(body.withdraw_to || body.to || body.user);
    const tokenId = Number(body.token_id || 0);
    const reqEth = Number(body.amount || 0);

    log.push("[REQ USER]", user);
    log.push("[WITHDRAW TO]", withdrawTo);
    log.push("[REQ TOKEN ID]", tokenId);
    log.push("[REQ AMOUNT NUM]", reqEth);

    if (!user) {
      log.push("[FAIL] NO USER");
      return res.json({ ok: false, error: "bad_input_user", logs: log.rows });
    }

    if (!tokenId || tokenId <= 0) {
      log.push("[FAIL] BAD TOKEN ID");
      return res.json({ ok: false, error: "bad_input_token_id", logs: log.rows });
    }

    if (!reqEth || reqEth <= 0) {
      log.push("[FAIL] BAD AMOUNT");
      return res.json({ ok: false, error: "bad_input_amount", logs: log.rows });
    }

    const web3 = await initWeb3(log);

    if (!web3.utils.isAddress(withdrawTo)) {
      log.push("[FAIL] BAD WITHDRAW TO");
      return res.json({ ok: false, error: "bad_withdraw_to", logs: log.rows });
    }

    const contractAddr = process.env.CONTRACT_ADDRESS;
    if (!contractAddr) {
      log.push("[FAIL] MISSING CONTRACT_ADDRESS");
      return res.json({ ok: false, error: "missing_contract_address", logs: log.rows });
    }

    if (!process.env.PRIVATE_KEY) {
      log.push("[FAIL] MISSING PRIVATE_KEY");
      return res.json({ ok: false, error: "missing_private_key", logs: log.rows });
    }

    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    );
    web3.eth.accounts.wallet.add(owner);

    log.push("[OWNER]", owner.address);
    log.push("[CONTRACT]", contractAddr);

    const grossWei = web3.utils.toWei(reqEth.toString(), "ether");
    log.push("[GROSS WEI]", grossWei);

    const ownerNativeBalance = await web3.eth.getBalance(owner.address);
    const contractNativeBalance = await web3.eth.getBalance(contractAddr);

    log.push("[OWNER NATIVE BALANCE]", ownerNativeBalance);
    log.push("[CONTRACT NATIVE BALANCE]", contractNativeBalance);

    const method = contract.methods.backendWithdraw(withdrawTo, grossWei);

    try {
      await method.call({ from: owner.address });
      log.push("[CALL PRECHECK] OK");
    } catch (e) {
      log.push("[CALL PRECHECK FAIL]", e.message || String(e));
      throw e;
    }

    let gasLimit;
    try {
      gasLimit = await method.estimateGas({ from: owner.address });
      log.push("[GAS LIMIT]", gasLimit);
    } catch (e) {
      log.push("[ESTIMATE GAS FAIL]", e.message || String(e));
      throw e;
    }

    const block = await web3.eth.getBlock("latest");
    const baseFee = block?.baseFeePerGas
      ? BigInt(block.baseFeePerGas)
      : BigInt(web3.utils.toWei("0.0000005", "ether"));

    const maxFeePerGas = baseFee * 2n;
    const priorityFee = BigInt(web3.utils.toWei("0.0000005", "ether"));
    const gasCostWei = BigInt(gasLimit) * maxFeePerGas;

    log.push("[BLOCK NUMBER]", block?.number);
    log.push("[BASE FEE]", baseFee.toString());
    log.push("[MAX FEE PER GAS]", maxFeePerGas.toString());
    log.push("[PRIORITY FEE]", priorityFee.toString());
    log.push("[GAS COST WEI]", gasCostWei.toString());

    const netWei = BigInt(grossWei) - gasCostWei;
    if (netWei <= 0n) {
      log.push("[FAIL] TOO SMALL FOR GAS");
      return res.json({ ok: false, error: "amount_too_small_for_gas", logs: log.rows });
    }

    log.push("[FINAL WEI]", netWei.toString());

    const tx = {
      from: owner.address,
      to: contractAddr,
      gas: gasLimit,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: priorityFee.toString(),
      data: contract.methods.backendWithdraw(
        withdrawTo,
        netWei.toString()
      ).encodeABI()
    };

    log.push("[TX BUILD OK]", tx);

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      process.env.PRIVATE_KEY
    );

    log.push("[SIGNED TX READY]");

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    log.push("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      token_id: tokenId,
      user: user,
      withdraw_to: withdrawTo,
      requested_eth: reqEth,
      sent_eth: web3.utils.fromWei(netWei.toString(), "ether"),
      gas_paid_by_backend: web3.utils.fromWei(gasCostWei.toString(), "ether"),
      owner_native_balance: web3.utils.fromWei(ownerNativeBalance, "ether"),
      contract_native_balance: web3.utils.fromWei(contractNativeBalance, "ether"),
      logs: log.rows
    });

  } catch (e) {
    log.push("[FATAL]", e?.message || String(e));
    if (e?.stack) log.push("[STACK]", e.stack);

    return res.json({
      ok: false,
      error: e?.message || "unknown_error",
      logs: log.rows
    });
  }
}