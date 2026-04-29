console.log("=== BOOT: CHAINVERS chaingetcashdraw.js WITH INIT DEBUG ===");

import Web3 from "web3";

export const maxDuration = 60;

/* ============================================================ */
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

/* ============================================================ */
export default async function handler(req, res) {
  const log = logCollector();

  try {
    const body = await parseBody(req);

    const action = (body.action || "").toLowerCase();
    const tokenId = Number(body.token_id || 0);

    log.push("[ACTION]", action || "withdraw");
    log.push("[BODY]", JSON.stringify(body));

    const web3 = await initWeb3(log);

    const abi = loadAbi(log);
    const contract = new web3.eth.Contract(
      abi,
      process.env.CONTRACT_ADDRESS
    );

    const account = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    );
    web3.eth.accounts.wallet.add(account);

    log.push("[SENDER]", account.address);
    log.push("[CONTRACT]", process.env.CONTRACT_ADDRESS);

    /* ============================================================
       CHECK OWNER
    ============================================================ */
    let ownerAddr = "unknown";

    try {
      ownerAddr = await contract.methods.owner().call();
      log.push("[OWNER]", ownerAddr);
    } catch (e) {
      log.push("[OWNER READ FAIL]", e.message);
    }

    /* ============================================================
       INITIALIZE (NEW)
    ============================================================ */
    if (action === "initialize") {
      log.push("[INIT TRY]");

      try {
        const method = contract.methods.initialize();

        // test call
        await method.call({ from: account.address });
        log.push("[INIT CALL OK]");

        const gas = await method.estimateGas({
          from: account.address
        });

        log.push("[INIT GAS]", gas);

        const tx = {
          from: account.address,
          to: process.env.CONTRACT_ADDRESS,
          gas,
          data: method.encodeABI()
        };

        const signed = await web3.eth.accounts.signTransaction(
          tx,
          process.env.PRIVATE_KEY
        );

        const sent = await web3.eth.sendSignedTransaction(
          signed.rawTransaction
        );

        log.push("[INIT TX OK]", sent.transactionHash);

        const newOwner = await contract.methods.owner().call();
        log.push("[NEW OWNER]", newOwner);

        return res.json({
          ok: true,
          action: "initialized",
          tx: sent.transactionHash,
          new_owner: newOwner,
          logs: log.rows
        });

      } catch (e) {
        log.push("[INIT FAIL]", e.message);

        return res.json({
          ok: false,
          error: "initialize_failed",
          detail: e.message,
          owner_now: ownerAddr,
          logs: log.rows
        });
      }
    }

    /* ============================================================
       NORMAL WITHDRAW (NFT OWNER)
    ============================================================ */
    if (!tokenId) {
      return res.json({ ok: false, error: "bad_token_id", logs: log.rows });
    }

    const copyOriginal = await contract.methods.copyToOriginal(tokenId).call();
    const isCopy = Number(copyOriginal) !== 0;

    log.push("[IS COPY]", isCopy ? "YES" : "NO");

    let balanceWei = "0";
    let method;

    if (isCopy) {
      balanceWei = await contract.methods.copyBalance(tokenId).call();
      method = contract.methods.withdrawCopy(tokenId);
    } else {
      balanceWei = await contract.methods.originBalance(tokenId).call();
      method = contract.methods.withdrawOrigin(tokenId);
    }

    log.push("[CHAIN BALANCE]", balanceWei);

    if (BigInt(balanceWei) <= 0n) {
      return res.json({
        ok: false,
        error: "nothing_on_chain",
        logs: log.rows
      });
    }

    try {
      await method.call({ from: account.address });
      log.push("[CALL OK]");
    } catch (e) {
      log.push("[CALL FAIL]", e.message);
      throw e;
    }

    const gas = await method.estimateGas({ from: account.address });

    const tx = {
      from: account.address,
      to: process.env.CONTRACT_ADDRESS,
      gas,
      data: method.encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      process.env.PRIVATE_KEY
    );

    const sent = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    log.push("[TX OK]", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      logs: log.rows
    });

  } catch (e) {
    log.push("[ERROR]", e.message);
    return res.json({
      ok: false,
      error: e.message,
      logs: log.rows
    });
  }
}