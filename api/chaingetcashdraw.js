import Web3 from "web3";

const RPC = process.env.PROVIDER_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT = process.env.CONTRACT_ADDRESS;

const web3 = new Web3(RPC);

const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "name":"originBalance",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "name":"copyBalance",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "name":"copyToOriginal",
    "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawOrigin",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawCopy",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

const contract = new web3.eth.Contract(ABI, CONTRACT);

const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const action = req.query.action;

    // --------------------------------------------------------
    // GET ONCHAIN BALANCE
    // --------------------------------------------------------
    if (action === "balance") {
      const id = req.query.id;

      const isCopy = await contract.methods.copyToOriginal(id).call();

      if (isCopy === "0") {
        const bal = await contract.methods.originBalance(id).call();
        return res.json({ ok: true, type:"origin", balance: bal });
      } else {
        const bal = await contract.methods.copyBalance(id).call();
        return res.json({ ok: true, type:"copy", balance: bal });
      }
    }

    // --------------------------------------------------------
    // WITHDRAW (COPYMINT STYLE)
    // --------------------------------------------------------
    if (action === "withdraw") {

      let { id } = req.body;
      id = Number(id);

      // Identify token type
      const isCopy = await contract.methods.copyToOriginal(id).call();

      const method =
        (isCopy === "0")
          ? contract.methods.withdrawOrigin(id)
          : contract.methods.withdrawCopy(id);

      // Gas estimation
      const gas = await method.estimateGas({ from: account.address });

      // Build transaction
      const tx = {
        from: account.address,
        to: CONTRACT,
        gas,
        data: method.encodeABI()
      };

      // Sign & send
      const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.json({
        ok: true,
        tx: sent.transactionHash,
        type: isCopy === "0" ? "origin" : "copy"
      });
    }

    return res.json({ ok:false, error:"unknown action" });

  } catch (e) {
    return res.json({ ok:false, error:e.message });
  }
}