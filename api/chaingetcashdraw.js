import Web3 from "web3";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL; // https://TVOJWEB.com (bez / na konci)

/* ======================= RPC FALLBACK ======================= */
const RPCs = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

async function initWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("Using RPC:", rpc);
      return w3;
    } catch (e) {}
  }
  throw new Error("All RPCs failed.");
}

/* ======================= ABI ======================= */
const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],
    "name":"withdrawToken",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

/* ======================= DOWNLOAD ORDERS.JSON ======================= */
async function loadOrders(user) {
  const url = `${INF_FREE_URL}/chainuserdata/${user}/orders.json?bypass=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Cannot load orders.json");
  return await res.json();
}

/* ======================= SAVE UPDATED ORDERS ======================= */
async function saveOrders(user, orders) {
  const url = `${INF_FREE_URL}/save_orders.php`;
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ user, orders })
  });
  const txt = await res.text();
  console.log("SAVE:", txt);
}

/* ======================= HANDLER ======================= */
export default async function handler(req, res) {
  try {
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);

    const action  = req.query.action;
    const user    = req.query.user;
    const tokenId = req.query.tokenId ? parseInt(req.query.tokenId) : null;

    if (!user) return res.status(200).send("Missing user");

    // 🔥 load orders.json
    let orders = await loadOrders(user);

    // orders.json môže byť array aj object → normalizujeme
    if (!Array.isArray(orders)) {
      if (orders.orders) orders = orders.orders;
      else orders = [orders];
    }

    // nájde contract_gain podľa tokenId
    const getGain = (tid) => {
      for (const o of orders) {
        const id = o.token_id ?? o.tokenId ?? null;
        if (parseInt(id) === parseInt(tid)) {
          let raw = o.contract_gain ?? o.contractGain ?? o.gain ?? 0;
          return parseFloat(raw);
        }
      }
      return 0;
    };

    // nulovanie contract_gain
    const zeroGain = (tid) => {
      for (const o of orders) {
        const id = o.token_id ?? o.tokenId ?? null;
        if (parseInt(id) === parseInt(tid)) {
          o.contract_gain = 0;
        }
      }
    };

    /* ==========================================================
       1) WITHDRAW SINGLE TOKEN
       ========================================================== */
    if (action === "withdraw") {

      const gain = getGain(tokenId);
      if (gain <= 0) return res.status(200).send("No balance");

      const gasBalance = await w3.eth.getBalance(FROM);
      if (BigInt(gasBalance) < 10000000000000n)
        return res.status(200).send("Not enough gas");

      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM });

      const signed = await w3.eth.accounts.signTransaction({
        to: CONTRACT,
        data: tx.encodeABI(),
        gas,
        from: FROM
      }, PRIVATE_KEY);

      const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);

      // update orders.json
      zeroGain(tokenId);
      await saveOrders(user, orders);

      return res.status(200).send("Withdraw OK: " + result.transactionHash);
    }

    /* ==========================================================
       2) WITHDRAW ALL TOKENS
       ========================================================== */
    if (action === "withdrawAll") {

      let hashes = [];

      for (const o of orders) {
        const tid = o.token_id ?? o.tokenId ?? null;
        if (!tid) continue;

        let gain = parseFloat(
          o.contract_gain ?? o.contractGain ?? o.gain ?? 0
        );

        if (gain <= 0) continue;

        const tx = contract.methods.withdrawToken(tid);
        const gas = await tx.estimateGas({ from: FROM });

        const signed = await w3.eth.accounts.signTransaction({
          to: CONTRACT,
          data: tx.encodeABI(),
          gas,
          from: FROM
        }, PRIVATE_KEY);

        const result =
          await w3.eth.sendSignedTransaction(signed.rawTransaction);

        hashes.push(result.transactionHash);

        // zero gain
        o.contract_gain = 0;
      }

      await saveOrders(user, orders);

      return res.status(200).send("Withdraw ALL OK: " + hashes.join(", "));
    }

    return res.status(200).send("Unknown action");

  } catch (e) {
    console.error(e);
    return res.status(200).send("Error: " + e.message);
  }
}