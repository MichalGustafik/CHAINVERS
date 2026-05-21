console.log("=== BOOT: CHAINVERS chaingetcashdraw.js BACKEND WITHDRAW ===");

import Web3 from "web3";

export const maxDuration = 60;

const ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "backendWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function logCollector() {
  const rows = [];

  return {
    push: (...args) => {
      const msg = `[${new Date().toISOString()}] ` + args.join(" ");
      console.log(msg);
      rows.push(msg);
    },
    rows
  };
}

function cleanPrivateKey(pk) {
  if (!pk) return "";
  pk = String(pk).trim();
  return pk.startsWith("0x") ? pk : "0x" + pk;
}

function ethToWei(web3, amount) {
  const n = Number(String(amount).replace(",", "."));

  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return web3.utils.toWei(n.toFixed(18), "ether");
}

export default async function handler(req, res) {
  const log = logCollector();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "method_not_allowed",
        logs: log.rows
      });
    }

    const body = await parseBody(req);

    const action = String(body.action || "withdraw").toLowerCase();
    const user = String(body.user || "").toLowerCase().trim();
    const withdrawTo = String(body.withdraw_to || user).toLowerCase().trim();
    const tokenId = Number(body.token_id || 0);
    const amountEth = String(body.amount || "0").replace(",", ".");

    log.push("[ACTION]", action);
    log.push("[BODY]", JSON.stringify(body));

    if (!process.env.PROVIDER_URL) {
      return res.json({
        ok: false,
        error: "missing_PROVIDER_URL",
        logs: log.rows
      });
    }

    if (!process.env.CONTRACT_ADDRESS) {
      return res.json({
        ok: false,
        error: "missing_CONTRACT_ADDRESS",
        logs: log.rows
      });
    }

    if (!process.env.PRIVATE_KEY) {
      return res.json({
        ok: false,
        error: "missing_PRIVATE_KEY",
        logs: log.rows
      });
    }

    const web3 = new Web3(process.env.PROVIDER_URL);

    const block = await web3.eth.getBlockNumber();
    log.push("[RPC OK] BLOCK", String(block));

    const pk = cleanPrivateKey(process.env.PRIVATE_KEY);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);

    const contractAddress = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddress);

    log.push("[SENDER]", account.address);
    log.push("[CONTRACT]", contractAddress);

    let ownerNow = "unknown";

    try {
      ownerNow = await contract.methods.owner().call();
      log.push("[OWNER]", ownerNow);
    } catch (e) {
      log.push("[OWNER READ FAIL]", e.message);
    }

    if (action === "initialize") {
      return res.json({
        ok: false,
        error: "initialize_disabled",
        detail: "Initialize nerob cez chaingetcashdraw.js. Tento endpoint je iba na backendWithdraw.",
        owner_now: ownerNow,
        logs: log.rows
      });
    }

    if (!tokenId || tokenId <= 0) {
      return res.json({
        ok: false,
        error: "bad_token_id",
        token_id: tokenId,
        logs: log.rows
      });
    }

    if (!web3.utils.isAddress(withdrawTo)) {
      return res.json({
        ok: false,
        error: "bad_withdraw_to",
        withdraw_to: withdrawTo,
        logs: log.rows
      });
    }

    const amountWei = ethToWei(web3, amountEth);

    if (!amountWei || BigInt(amountWei) <= 0n) {
      return res.json({
        ok: false,
        error: "bad_amount",
        amount: amountEth,
        logs: log.rows
      });
    }

    log.push("[TOKEN ID]", tokenId);
    log.push("[WITHDRAW TO]", withdrawTo);
    log.push("[AMOUNT ETH]", amountEth);
    log.push("[AMOUNT WEI]", amountWei);

    const ownerNativeBalance = await web3.eth.getBalance(account.address);
    const contractNativeBalance = await web3.eth.getBalance(contractAddress);

    log.push("[OWNER NATIVE BALANCE]", ownerNativeBalance);
    log.push("[CONTRACT NATIVE BALANCE]", contractNativeBalance);

    if (BigInt(contractNativeBalance) < BigInt(amountWei)) {
      return res.json({
        ok: false,
        error: "contract_native_balance_too_low",
        contract_balance_wei: contractNativeBalance,
        requested_wei: amountWei,
        logs: log.rows
      });
    }

    const method = contract.methods.backendWithdraw(withdrawTo, amountWei);

    try {
      await method.call({
        from: account.address
      });

      log.push("[CALL OK] backendWithdraw");
    } catch (e) {
      log.push("[CALL FAIL]", e.message);

      return res.json({
        ok: false,
        error: "backendWithdraw_call_failed",
        detail: e.message,
        owner_now: ownerNow,
        sender: account.address,
        logs: log.rows
      });
    }

    let gas;

    try {
      const estimatedGas = await method.estimateGas({
        from: account.address
      });

      gas = Math.ceil(Number(estimatedGas) * 1.25);

      log.push("[GAS ESTIMATE]", String(estimatedGas));
      log.push("[GAS USED LIMIT]", String(gas));
    } catch (e) {
      log.push("[GAS FAIL]", e.message);

      return res.json({
        ok: false,
        error: "estimate_gas_failed",
        detail: e.message,
        logs: log.rows
      });
    }

    const gasPrice = await web3.eth.getGasPrice();
    const nonce = await web3.eth.getTransactionCount(account.address, "pending");

    log.push("[GAS PRICE]", String(gasPrice));
    log.push("[NONCE]", String(nonce));

    const tx = {
      from: account.address,
      to: contractAddress,
      gas,
      gasPrice,
      nonce,
      data: method.encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(tx, pk);

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    log.push("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      action: "backendWithdraw",
      tx: sent.transactionHash,
      token_id: tokenId,
      withdraw_to: withdrawTo,
      amount_eth: amountEth,
      amount_wei: amountWei,
      logs: log.rows
    });

  } catch (e) {
    log.push("[HANDLER ERROR]", e.message);

    return res.json({
      ok: false,
      error: "handler_error",
      detail: e.message,
      logs: log.rows
    });
  }
}