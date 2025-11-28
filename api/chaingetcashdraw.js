import Web3 from "web3";
import fs from "fs";
import path from "path";

const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const IF_URL       = process.env.INF_FREE_URL;

// RPC fallback
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
    } catch {}
  }
  throw new Error("RPCs unreachable");
}

// Contract ABI (minimal withdraw)
const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],
    "name":"withdrawToken",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

export default async function handler(req, res) {
  try {
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);

    const action = req.query.action;
    const user   = req.query.user;
    const tokenId = req.query.tokenId ? parseInt(req.query.tokenId) : null;

    if (!user)
      return res.status(200).send("Missing user");

    // 🔥 Načítame orders.json z InfinityFree
    const url = `${IF_URL}/chainuserdata/${user}/orders.json?bypass=${Date.now()}`;
    let file = await fetch(url);
    let orders = await file.json();

    // Pomocná funkcia na získanie contract_gain
    function getGain(id) {
      for (const o of orders) {
        if (parseInt(o.tokenId) === parseInt(id))
          return parseFloat(o.contract_gain || 0);
      }
      return 0;
    }

    async function saveOrders() {
      await fetch(`${IF_URL}/save_orders.php`, {
        method: "POST",
        body: JSON.stringify({ user, orders })
      });
    }

    // -----------------------------
    // 1) WITHDRAW SINGLE TOKEN
    // -----------------------------
    if (action === "withdraw") {

      const gain = getGain(tokenId);
      if (gain <= 0)
        return res.status(200).send("No balance");

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

      // vynulujeme gain
      for (const o of orders) {
        if (parseInt(o.tokenId) === tokenId) {
          o.contract_gain = 0;
        }
      }
      await saveOrders();

      return res.status(200).send("Success: " + result.transactionHash);
    }

    // -----------------------------
    // 2) WITHDRAW ALL TOKENS
    // -----------------------------
    if (action === "withdrawAll") {

      let hashes = [];

      for (const o of orders) {
        const id = parseInt(o.tokenId || 0);
        const gain = parseFloat(o.contract_gain || 0);
        if (id <= 0 || gain <= 0) continue;

        const tx = contract.methods.withdrawToken(id);
        const gas = await tx.estimateGas({ from: FROM });

        const signed = await w3.eth.accounts.signTransaction({
          to: CONTRACT,
          data: tx.encodeABI(),
          gas,
          from: FROM
        }, PRIVATE_KEY);

        const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);
        hashes.push(result.transactionHash);

        o.contract_gain = 0;
      }

      await saveOrders();
      return res.status(200).send("All success: " + hashes.join(", "));
    }

    return res.status(200).send("Unknown action");

  } catch (err) {
    return res.status(200).send("Error: " + err.message);
  }
}