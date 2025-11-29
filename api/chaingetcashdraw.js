import Web3 from "web3";

const RPC = process.env.PROVIDER_URL;        // Infura / Base RPC
const PRIVATE_KEY = process.env.PRIVATE_KEY; // tvoje owner PK
const CONTRACT = process.env.CONTRACT_ADDRESS;

const web3 = new Web3(RPC);

const ABI = [
  // balance reads
  {"inputs":[{"type":"uint256"}],"name":"originBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"copyBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"copyToOriginal","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},

  // withdraw functions
  {"inputs":[{"type":"uint256","name":"id"}],"name":"withdrawOrigin","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"type":"uint256","name":"id"}],"name":"withdrawCopy","outputs":[],"stateMutability":"nonpayable","type":"function"},
];

const contract = new web3.eth.Contract(ABI, CONTRACT);
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const action = req.query.action;

    /* ======================================================
       GET ONCHAIN BALANCE (origin or copy)
    ======================================================= */
    if (action === "balance") {
      const id = req.query.id;
      const isCopy = await contract.methods.copyToOriginal(id).call();
      if (isCopy == 0) {
        const bal = await contract.methods.originBalance(id).call();
        return res.json({ type:"origin", balance: bal });
      } else {
        const bal = await contract.methods.copyBalance(id).call();
        return res.json({ type:"copy", balance: bal });
      }
    }

    /* ======================================================
       WITHDRAW (backend signs, user pays 0 gas)
    ======================================================= */
    if (action === "withdraw") {
      let { id, amountWei } = req.body;

      id = Number(id);
      amountWei = String(amountWei);

      // zisti či je origin alebo copy
      const isCopy = await contract.methods.copyToOriginal(id).call();
      const method = (isCopy == 0)
          ? contract.methods.withdrawOrigin(id)
          : contract.methods.withdrawCopy(id);

      const gas = await method.estimateGas({ from: account.address });
      const txData = method.encodeABI();

      const tx = {
        from: account.address,
        to: CONTRACT,
        gas,
        data: txData
      };

      const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.json({ ok:true, tx: sent.transactionHash });
    }

    return res.json({ error:"unknown action" });

  } catch (e) {
    return res.json({ error:e.message });
  }
}