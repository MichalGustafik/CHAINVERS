import Web3 from "web3";

/* ============================================================
   ENV VARS
============================================================ */
const RPC = process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT = process.env.CONTRACT_ADDRESS;   // 🔥 CHÝBAJÚCE !!!

const web3 = new Web3(RPC);

/* ============================================================
   CONTRACT ABI
============================================================ */
const ABI = [
  { "inputs":[{"type":"uint256"}], "name":"originBalance", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[{"type":"uint256"}], "name":"copyBalance",   "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
  { "inputs":[{"type":"uint256"}], "name":"copyToOriginal","outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },

  { "inputs":[{"type":"uint256","name":"id"}], "name":"withdrawOrigin", "outputs":[], "stateMutability":"nonpayable", "type":"function" },
  { "inputs":[{"type":"uint256","name":"id"}], "name":"withdrawCopy",   "outputs":[], "stateMutability":"nonpayable", "type":"function" }
];

const contract = new web3.eth.Contract(ABI, CONTRACT);

/* ============================================================
   LOAD OWNER WALLET
============================================================ */
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);


/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const action = req.query.action;

    /* ============================================================
       GET ON-CHAIN BALANCE FOR TOKEN
    ============================================================= */
    if (action === "balance") {

      const id = req.query.id;
      if (!id) return res.json({ error: "missing id" });

      const isCopy = await contract.methods.copyToOriginal(id).call();

      if (isCopy === "0") {
        const bal = await contract.methods.originBalance(id).call();
        return res.json({ type:"origin", balance: bal });
      } else {
        const bal = await contract.methods.copyBalance(id).call();
        return res.json({ type:"copy", balance: bal });
      }
    }


    /* ============================================================
       WITHDRAW (BACKEND PAYS GAS)
    ============================================================= */
    if (action === "withdraw") {

      let { id } = req.body;
      id = Number(id);

      // zisti či je token origin alebo copy
      const isCopy = await contract.methods.copyToOriginal(id).call();

      const method = (isCopy === "0")
        ? contract.methods.withdrawOrigin(id)
        : contract.methods.withdrawCopy(id);

      // Odhad gas:
      const gas = await method.estimateGas({ from: account.address });
      const encoded = method.encodeABI();

      const tx = {
        from: account.address,
        to: CONTRACT,
        gas,
        data: encoded
      };

      const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.json({
        ok: true,
        tx: sent.transactionHash,
        type: (isCopy === "0") ? "origin" : "copy"
      });
    }

    return res.json({ error:"Unknown action" });

  } catch (e) {
    return res.json({ error: e.message });
  }
}