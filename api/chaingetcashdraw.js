import Web3 from "web3";

/* ============================================================
   LOAD ENV VARS (DEBUG)
============================================================ */
const RPC = process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT = process.env.CONTRACT_ADDRESS;

console.log("=== CHAINVERS DEBUG START ===");
console.log("RPC:", RPC);
console.log("CONTRACT:", CONTRACT);
console.log("PRIVATE_KEY:", PRIVATE_KEY ? "(loaded)" : "(MISSING!)");

/* ============================================================
   INIT WEB3
============================================================ */
let web3;
try {
  web3 = new Web3(RPC);
  console.log("Web3 initialized OK");
} catch (err) {
  console.log("Web3 INIT ERROR:", err.message);
}

/* ============================================================
   CONTRACT ABI
============================================================ */
const ABI = [
  { "inputs":[{"type":"uint256"}],"name":"originBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function" },
  { "inputs":[{"type":"uint256"}],"name":"copyBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function" },
  { "inputs":[{"type":"uint256"}],"name":"copyToOriginal","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function" },

  { "inputs":[{"type":"uint256","name":"id"}],"name":"withdrawOrigin","outputs":[],"stateMutability":"nonpayable","type":"function" },
  { "inputs":[{"type":"uint256","name":"id"}],"name":"withdrawCopy","outputs":[],"stateMutability":"nonpayable","type":"function" }
];

let contract;
try {
  contract = new web3.eth.Contract(ABI, CONTRACT);
  console.log("Contract OK:", CONTRACT);
} catch (err) {
  console.log("CONTRACT INIT ERROR:", err.message);
}

/* ============================================================
   LOAD OWNER WALLET
============================================================ */
let account;
try {
  account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
  web3.eth.accounts.wallet.add(account);
  console.log("Owner wallet loaded:", account.address);
} catch (err) {
  console.log("PRIVATE KEY ERROR:", err.message);
}

/* ============================================================
   API HANDLER
============================================================ */
export default async function handler(req, res) {

  console.log("=== API CALL ===");
  console.log("Query:", req.query);
  console.log("Body:", req.body);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const action = req.query.action;

    /* ============================================================
       ACTION: BALANCE
    ============================================================= */
    if (action === "balance") {
      const id = req.query.id;
      console.log("BALANCE REQUEST id:", id);

      try {
        const isCopy = await contract.methods.copyToOriginal(id).call();
        console.log("copyToOriginal =", isCopy);

        if (isCopy === "0") {
          const bal = await contract.methods.originBalance(id).call();
          console.log("Origin balance =", bal);
          return res.json({ ok:true, type:"origin", balance:bal });
        } else {
          const bal = await contract.methods.copyBalance(id).call();
          console.log("Copy balance =", bal);
          return res.json({ ok:true, type:"copy", balance:bal });
        }
      } catch (err) {
        console.log("BALANCE ERROR:", err.message);
        return res.json({ ok:false, error:err.message });
      }
    }

    /* ============================================================
       ACTION: WITHDRAW
    ============================================================= */
    if (action === "withdraw") {
      let { id } = req.body;
      id = Number(id);

      console.log("WITHDRAW REQUEST id:", id);

      const isCopy = await contract.methods.copyToOriginal(id).call();
      console.log("Token copyToOriginal =", isCopy);

      const method = (isCopy === "0")
        ? contract.methods.withdrawOrigin(id)
        : contract.methods.withdrawCopy(id);

      /* Gas estimation */
      let gas;
      try {
        gas = await method.estimateGas({ from: account.address });
        console.log("Gas estimate =", gas);
      } catch (err) {
        console.log("GAS ESTIMATE ERROR:", err.message);
        return res.json({ ok:false, error:"estimateGas: " + err.message });
      }

      const encoded = method.encodeABI();

      const tx = {
        from: account.address,
        to: CONTRACT,
        gas,
        data: encoded
      };

      console.log("Sending TX:", tx);

      try {
        const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
        console.log("TX signed OK");

        const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);
        console.log("TX SENT HASH:", sent.transactionHash);

        return res.json({
          ok:true,
          tx: sent.transactionHash,
          type: (isCopy === "0" ? "origin" : "copy")
        });

      } catch (err) {
        console.log("SEND TX ERROR:", err.message);
        return res.json({ ok:false, error:"sendTx: " + err.message });
      }
    }

    return res.json({ ok:false, error:"Unknown action" });

  } catch (err) {
    console.log("HANDLER ERROR:", err.message);
    return res.json({ ok:false, error: err.message });
  }
}