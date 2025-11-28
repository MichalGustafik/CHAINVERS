import Web3 from "web3";
import fs from "fs";
import path from "path";

const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const IF_URL       = process.env.INF_FREE_URL; // antibot bypass

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
    } catch(e) {}
  }
  throw new Error("All RPCs failed.");
}

// Minimal ABI for withdraw from your contract
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

    const action   = req.query.action;
    const user     = req.query.user;
    const tokenId  = req.query.tokenId ? parseInt(req.query.tokenId) : null;

    if (!user) return res.status(200).send("Missing user.");

    // 🔎 Načítame orders.json
    const ordersPath = path.join("/tmp", `${user}-orders.json`);

    // Stiahneme orders.json z InfinityFree (antibot bypass)
    let ordersJson = await fetch(`${IF_URL}/chainuserdata/${user}/orders.json?bypass=${Date.now()}`);
    let orders = await ordersJson.json();

    // Pomocná funkcia: získanie balance pre NFT
    function getGain(id) {
      for (const o of orders) {
        if (parseInt(o.tokenId) === parseInt(id)) {
          return parseFloat(o.contract_gain || 0);
        }
      }
      return 0;
    }

    if (action === "withdraw") {

      const gain = getGain(tokenId);
      if (gain <= 0) return res.status(200).send("No balance for this token.");

      const valueWei = w3.utils.toWei(gain.toString(), "ether");

      // Gas check
      const gasBalance = await w3.eth.getBalance(FROM);
      if (gasBalance < 10000000000000n) { // 0.00001 ETH
        return res.status(200).send("Not enough gas on FROM.");
      }

      // Transaction
      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM });
      const data = tx.encodeABI();

      const signed = await w3.eth.accounts.signTransaction({
        to: CONTRACT,
        data,
        gas,
        from: FROM
      }, PRIVATE_KEY);

      const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);

      // Po úspechu vynulujeme contract_gain
      for (const o of orders) {
        if (parseInt(o.tokenId) === tokenId) {
          o.contract_gain = 0;
        }
      }

      // Upload späť na InfinityFree
      await fetch(`${IF_URL}/save_orders.php`, {
        method: "POST",
        body: JSON.stringify({ user, orders })
      });

      return res.status(200).send("Success: " + result.transactionHash);
    }

    if (action === "withdrawAll") {
      let total = 0;
      let txList = [];

      for (const o of orders) {
        if (!o.tokenId) continue;
        const t = parseInt(o.tokenId);
        const gain = parseFloat(o.contract_gain || 0);
        if (gain <= 0) continue;

        const tx = contract.methods.withdrawToken(t);
        const gas = await tx.estimateGas({ from: FROM });
        const data = tx.encodeABI();

        const signed = await w3.eth.accounts.signTransaction({
          to: CONTRACT,
          data,
          gas,
          from: FROM
        }, PRIVATE_KEY);

        const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);
        txList.push(result.transactionHash);

        o.contract_gain = 0;
        total += gain;
      }

      await fetch(`${IF_URL}/save_orders.php`, {
        method: "POST",
        body: JSON.stringify({ user, orders })
      });

      return res.status(200).send("All success: " + txList.join(", "));
    }

    res.status(200).send("Unknown action.");

  } catch (e) {
    res.status(200).send("Error: " + e.message);
  }
}