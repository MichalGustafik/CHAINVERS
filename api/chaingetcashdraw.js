import Web3 from "web3";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

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
    "stateMutability":"payable",
    "type":"function"
  }
];

/* ======================= LOAD ORDERS ======================= */
async function loadOrders(user) {
  const url = `${INF_FREE_URL}/get_orders.php?user=${user}&bypass=${Date.now()}`;
  const res = await fetch(url);
  const txt = await res.text();

  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error("Invalid orders.json response: " + txt);
  }
}

/* ======================= SAVE ORDERS ======================= */
async function saveOrders(user, orders) {
  const url = `${INF_FREE_URL}/save_orders.php`;
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ user, orders })
  });
  return await res.text();
}

/* ======================= GET / UPDATE GAIN ======================= */
const findGain = (orders, tid) => {
  for (const o of orders) {
    const id = o.token_id ?? o.tokenId;
    if (parseInt(id) === parseInt(tid)) {
      return parseFloat(o.contract_gain ?? 0);
    }
  }
  return 0;
};

const updateGain = (orders, tid, newValue) => {
  for (const o of orders) {
    const id = o.token_id ?? o.tokenId;
    if (parseInt(id) === parseInt(tid)) {
      o.contract_gain = newValue;
    }
  }
};

/* ======================= HANDLER ======================= */
export default async function handler(req, res) {
  try {
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);

    const action   = req.query.action;
    const user     = req.query.user;
    const tokenId  = req.query.tokenId ? parseInt(req.query.tokenId) : null;
    const amountIn = req.query.amount ? parseFloat(req.query.amount) : null;

    if (!user) return res.status(200).send("Missing user");

    // Load orders.json
    let orders = await loadOrders(user);

    if (!Array.isArray(orders)) {
      if (orders.orders) orders = orders.orders;
      else orders = [orders];
    }

    /* ===================================================
       DYNAMIC WITHDRAW AMOUNT: withdrawAmount
       =================================================== */
    if (action === "withdrawAmount") {

      const gain = findGain(orders, tokenId);
      if (gain <= 0) return res.status(200).send("No balance in this token");

      const amount = Number(amountIn);

      const MIN = 0.0001; // minimálny withdraw v ETH
      if (amount < MIN) {
        return res.status(200).send("Amount too small (min 0.0001 ETH)");
      }

      if (amount > gain) {
        return res.status(200).send("Amount exceeds token gain");
      }

      // Gas kontrola
      const gasBalance = await w3.eth.getBalance(FROM);
      if (BigInt(gasBalance) < 5000000000000n) {
        return res.status(200).send("Not enough gas on FROM wallet");
      }

      // ETH amount → wei
      const valueWei = w3.utils.toWei(amount.toString(), "ether");

      // Transaction
      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM, value: valueWei });

      const signedTx = await w3.eth.accounts.signTransaction(
        {
          to: CONTRACT,
          data: tx.encodeABI(),
          gas: gas,
          from: FROM,
          value: valueWei
        },
        PRIVATE_KEY
      );

      const receipt = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      // Update orders.json
      const newGain = (gain - amount).toFixed(6);
      updateGain(orders, tokenId, newGain);

      await saveOrders(user, orders);

      return res.status(200).send(
        `SUCCESS: Withdrawn ${amount} ETH from NFT #${tokenId}\nTX: ${receipt.transactionHash}`
      );
    }

    /* ===================================================
       LEGACY: withdraw (full)
       =================================================== */
    if (action === "withdraw") {
      const gain = findGain(orders, tokenId);
      if (gain <= 0) return res.status(200).send("No balance");

      const valueWei = w3.utils.toWei(gain.toString(), "ether");
      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM, value: valueWei });

      const signed = await w3.eth.accounts.signTransaction({
        to: CONTRACT,
        data: tx.encodeABI(),
        gas,
        from: FROM,
        value: valueWei
      }, PRIVATE_KEY);

      const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);

      updateGain(orders, tokenId, 0);
      await saveOrders(user, orders);

      return res.status(200).send("SUCCESS: " + result.transactionHash);
    }

    /* ===================================================
       LEGACY: withdrawAll
       =================================================== */
    if (action === "withdrawAll") {
      let txs = [];

      for (const o of orders) {
        const tid = o.token_id ?? o.tokenId;
        let gain = parseFloat(o.contract_gain ?? 0);
        if (gain <= 0) continue;

        const valueWei = w3.utils.toWei(gain.toString(), "ether");
        const tx = contract.methods.withdrawToken(tid);
        const gas = await tx.estimateGas({ from: FROM, value: valueWei });

        const signed = await w3.eth.accounts.signTransaction({
          to: CONTRACT,
          data: tx.encodeABI(),
          gas,
          from: FROM,
          value: valueWei
        }, PRIVATE_KEY);

        const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);
        txs.push(result.transactionHash);

        o.contract_gain = 0;
      }

      await saveOrders(user, orders);
      return res.status(200).send("ALL SUCCESS: " + txs.join(", "));
    }

    return res.status(200).send("Unknown action");

  } catch (e) {
    console.error("ERR:", e);
    return res.status(200).send("Error: " + e.message);
  }
}