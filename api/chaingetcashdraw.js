console.log("=== BOOT: CHAINVERS chaingetcashdraw.js OLD WORKING WITHDRAW ===");

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
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "copyToOriginal",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "originBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "copyBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "withdrawOrigin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "withdrawCopy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function logger() {
  const rows = [];
  return {
    push: (...a) => {
      const m = `[${new Date().toISOString()}] ` + a.join(" ");
      console.log(m);
      rows.push(m);
    },
    rows
  };
}

function cleanPk(pk) {
  pk = String(pk || "").trim();
  return pk.startsWith("0x") ? pk : "0x" + pk;
}

export default async function handler(req, res) {
  const log = logger();

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
    const tokenId = Number(body.token_id || 0);

    log.push("[ACTION]", action);
    log.push("[BODY]", JSON.stringify(body));

    if (!process.env.PROVIDER_URL) {
      return res.json({ ok: false, error: "missing_PROVIDER_URL", logs: log.rows });
    }

    if (!process.env.CONTRACT_ADDRESS) {
      return res.json({ ok: false, error: "missing_CONTRACT_ADDRESS", logs: log.rows });
    }

    if (!process.env.PRIVATE_KEY) {
      return res.json({ ok: false, error: "missing_PRIVATE_KEY", logs: log.rows });
    }

    const web3 = new Web3(process.env.PROVIDER_URL);
    const block = await web3.eth.getBlockNumber();
    log.push("[RPC OK] block", String(block));

    const pk = cleanPk(process.env.PRIVATE_KEY);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);

    const contractAddress = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddress);

    log.push("[SENDER]", account.address);
    log.push("[CONTRACT]", contractAddress);

    let owner = "unknown";
    try {
      owner = await contract.methods.owner().call();
      log.push("[OWNER]", owner);
    } catch (e) {
      log.push("[OWNER READ FAIL]", e.message);
    }

    if (action === "initialize") {
      return res.json({
        ok: false,
        error: "initialize_disabled",
        detail: "Initialize nerob cez chaingetcashdraw.js.",
        owner_now: owner,
        logs: log.rows
      });
    }

    if (!tokenId || tokenId <= 0) {
      return res.json({
        ok: false,
        error: "bad_token_id",
        logs: log.rows
      });
    }

    const copyOriginal = await contract.methods.copyToOriginal(tokenId).call();
    const isCopy = BigInt(copyOriginal) !== 0n;

    log.push("[COPY ORIGINAL]", String(copyOriginal));
    log.push("[IS COPY]", isCopy ? "YES" : "NO");

    let balanceWei = "0";
    let method;

    if (isCopy) {
      balanceWei = await contract.methods.copyBalance(tokenId).call();
      method = contract.methods.withdrawCopy(tokenId);
      log.push("[WITHDRAW TYPE]", "copy");
    } else {
      balanceWei = await contract.methods.originBalance(tokenId).call();
      method = contract.methods.withdrawOrigin(tokenId);
      log.push("[WITHDRAW TYPE]", "origin");
    }

    log.push("[CHAIN BALANCE]", String(balanceWei));

    if (BigInt(balanceWei) <= 0n) {
      return res.json({
        ok: false,
        error: "nothing_on_chain",
        token_id: tokenId,
        balance_wei: String(balanceWei),
        logs: log.rows
      });
    }

    const beforeSender = await web3.eth.getBalance(account.address);
    const beforeContract = await web3.eth.getBalance(contractAddress);

    log.push("[BEFORE SENDER BALANCE]", String(beforeSender));
    log.push("[BEFORE CONTRACT BALANCE]", String(beforeContract));

    try {
      await method.call({ from: account.address });
      log.push("[CALL OK]");
    } catch (e) {
      log.push("[CALL FAIL]", e.message);
      return res.json({
        ok: false,
        error: "withdraw_call_failed",
        detail: e.message,
        owner_now: owner,
        sender: account.address,
        logs: log.rows
      });
    }

    let gas;
    try {
      const estimatedGas = await method.estimateGas({ from: account.address });
      gas = Math.ceil(Number(estimatedGas) * 1.25);
      log.push("[GAS ESTIMATE]", String(estimatedGas));
      log.push("[GAS LIMIT]", String(gas));
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
    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    const afterSender = await web3.eth.getBalance(account.address);
    const afterContract = await web3.eth.getBalance(contractAddress);

    log.push("[TX OK]", sent.transactionHash);
    log.push("[RECEIPT STATUS]", String(sent.status));
    log.push("[AFTER SENDER BALANCE]", String(afterSender));
    log.push("[AFTER CONTRACT BALANCE]", String(afterContract));

    return res.json({
      ok: true,
      action: isCopy ? "withdrawCopy" : "withdrawOrigin",
      tx: sent.transactionHash,
      token_id: tokenId,
      withdrawn_balance_wei: String(balanceWei),
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