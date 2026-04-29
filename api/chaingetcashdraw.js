console.log("=== BOOT: CHAINVERS chaingetcashdraw.js FINAL ===");

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

function normalize(u) {
  return String(u || "").trim().toLowerCase();
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
    const user = normalize(body.user);
    const to = normalize(body.withdraw_to || user);
    const amount = Number(body.amount || 0);

    log.push("[ACTION]", action || "withdraw");

    const web3 = await initWeb3(log);

    const abi = loadAbi(log);
    const contract = new web3.eth.Contract(
      abi,
      process.env.CONTRACT_ADDRESS
    );

    const owner = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    );
    web3.eth.accounts.wallet.add(owner);

    log.push("[OWNER]", owner.address);

    let realOwner = await contract.methods.owner().call();
    log.push("[CONTRACT OWNER]", realOwner);

    /* ============================================================
       INITIALIZE
    ============================================================ */
    if (action === "initialize") {
      if (realOwner !== "0x0000000000000000000000000000000000000000") {
        return res.json({ ok: false, error: "already_initialized", logs: log.rows });
      }

      const method = contract.methods.initialize();
      const gas = await method.estimateGas({ from: owner.address });

      const tx = {
        from: owner.address,
        to: process.env.CONTRACT_ADDRESS,
        gas,
        data: method.encodeABI()
      };

      const signed = await web3.eth.accounts.signTransaction(
        tx,
        process.env.PRIVATE_KEY
      );

      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      const newOwner = await contract.methods.owner().call();

      return res.json({
        ok: true,
        action: "initialized",
        tx: sent.transactionHash,
        new_owner: newOwner,
        logs: log.rows
      });
    }

    /* ============================================================
       OWNER CHECK
    ============================================================ */
    if (realOwner.toLowerCase() !== owner.address.toLowerCase()) {
      return res.json({
        ok: false,
        error: "owner_mismatch",
        contract_owner: realOwner,
        backend_owner: owner.address,
        logs: log.rows
      });
    }

    /* ============================================================
       WITHDRAW
    ============================================================ */
    const wei = web3.utils.toWei(amount.toString(), "ether");

    const method = contract.methods.backendWithdraw(to, wei);

    await method.call({ from: owner.address });

    const gas = await method.estimateGas({ from: owner.address });

    const tx = {
      from: owner.address,
      to: process.env.CONTRACT_ADDRESS,
      gas,
      data: method.encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      process.env.PRIVATE_KEY
    );

    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      logs: log.rows
    });

  } catch (e) {
    log.push("[ERROR]", e.message);
    return res.json({ ok: false, error: e.message, logs: log.rows });
  }
}