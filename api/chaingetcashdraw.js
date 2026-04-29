console.log("=== BOOT: CHAINVERS chaingetcashdraw.js WITHDRAW NFT OWNER ===");

import Web3 from "web3";

export const maxDuration = 60;

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

function loadAbi(log) {
  const abi = JSON.parse(process.env.CONTRACT_ABI || "[]");
  log.push("[ABI LOADED]", abi.length);
  return abi;
}

async function initWeb3(log) {
  const w = new Web3(process.env.PROVIDER_URL);
  await w.eth.getBlockNumber();
  log.push("[RPC OK]");
  return w;
}

export default async function handler(req, res) {
  const log = logCollector();

  try {
    const body = await parseBody(req);

    const tokenId = Number(body.token_id || 0);

    log.push("[BODY]", JSON.stringify(body));
    log.push("[TOKEN ID]", tokenId);

    if (!tokenId || tokenId <= 0) {
      return res.json({ ok: false, error: "bad_token_id", logs: log.rows });
    }

    const web3 = await initWeb3(log);

    if (!process.env.CONTRACT_ADDRESS) {
      return res.json({ ok: false, error: "missing_contract_address", logs: log.rows });
    }

    if (!process.env.PRIVATE_KEY) {
      return res.json({ ok: false, error: "missing_private_key", logs: log.rows });
    }

    const abi = loadAbi(log);
    const contract = new web3.eth.Contract(abi, process.env.CONTRACT_ADDRESS);

    const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);

    log.push("[SENDER]", account.address);
    log.push("[CONTRACT]", process.env.CONTRACT_ADDRESS);

    const copyOriginal = await contract.methods.copyToOriginal(tokenId).call();
    const isCopy = Number(copyOriginal) !== 0;

    log.push("[IS COPY]", isCopy ? "YES" : "NO");
    log.push("[COPY TO ORIGINAL]", copyOriginal);

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

    log.push("[CHAIN BALANCE WEI]", balanceWei);
    log.push("[CHAIN BALANCE ETH]", web3.utils.fromWei(balanceWei, "ether"));

    if (BigInt(balanceWei) <= 0n) {
      return res.json({
        ok: false,
        error: "nothing_to_withdraw_on_chain",
        token_id: tokenId,
        chain_balance_wei: balanceWei,
        chain_balance_eth: web3.utils.fromWei(balanceWei, "ether"),
        logs: log.rows
      });
    }

    try {
      await method.call({ from: account.address });
      log.push("[CALL PRECHECK] OK");
    } catch (e) {
      log.push("[CALL PRECHECK FAIL]", e.message || String(e));
      throw e;
    }

    const gas = await method.estimateGas({ from: account.address });
    log.push("[GAS]", gas);

    const tx = {
      from: account.address,
      to: process.env.CONTRACT_ADDRESS,
      gas,
      data: method.encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    log.push("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      token_id: tokenId,
      withdraw_type: isCopy ? "copy" : "origin",
      withdrawn_wei: balanceWei,
      withdrawn_eth: web3.utils.fromWei(balanceWei, "ether"),
      receiver: account.address,
      note: "withdrawOrigin/withdrawCopy posiela ETH na msg.sender, teda na adresu z PRIVATE_KEY.",
      logs: log.rows
    });

  } catch (e) {
    log.push("[ERROR]", e.message || String(e));
    return res.json({
      ok: false,
      error: e.message || "unknown_error",
      logs: log.rows
    });
  }
}