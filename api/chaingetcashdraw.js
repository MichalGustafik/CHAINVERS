import Web3 from "web3";

const RPC = "https://mainnet.base.org";
const CONTRACT = process.env.CONTRACT_ADDRESS;
const ABI = [
  // MINIMUM needed ABI for withdraw system
  {"inputs":[],"name":"tokenIdCounter","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"ownerOf","outputs":[{"type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"copyToOriginal","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"originBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},

  // withdrawOrigin(id)
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawOrigin",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

// INIT
const web3 = new Web3(RPC);
const contract = new web3.eth.Contract(ABI, CONTRACT);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const action = req.query.action;

  try {

    /* ============================================================
       1) LIST TOKENS (origin only)
    ============================================================ */
    if (action === "listTokens") {
      const wallet = req.query.wallet?.toLowerCase();
      if (!wallet) return res.status(400).json({error:"no wallet"});

      const counter = await contract.methods.tokenIdCounter().call();
      let tokens = [];

      for (let id = 1; id < counter; id++) {
        try {
          const owner = (await contract.methods.ownerOf(id).call()).toLowerCase();
          if (owner !== wallet) continue;

          const parent = await contract.methods.copyToOriginal(id).call();
          if (parent != 0) continue; // COPY → skip

          tokens.push(id);
        } catch {}
      }

      return res.json({tokens});
    }

    /* ============================================================
       2) GET BALANCE (originBalance)
    ============================================================ */
    if (action === "getBalance") {
      const id = req.query.id;
      const bal = await contract.methods.originBalance(id).call();
      return res.json({balance: bal});
    }

    /* ============================================================
       3) PREPARE WITHDRAW (raw tx)
    ============================================================ */
    if (action === "prepareWithdraw") {
      const id = req.body.id;
      const from = req.body.wallet;

      if (!id || !from)
        return res.status(400).json({error:"missing id/wallet"});

      const txData = contract.methods.withdrawOrigin(id).encodeABI();

      const tx = {
        from,
        to: CONTRACT,
        data: txData,
        gas: 120000 // safe
      };

      return res.json({tx});
    }

    /* ============================================================
       4) BROADCAST SIGNED TX
    ============================================================ */
    if (action === "broadcast") {
      const raw = req.body.signedTx;
      if (!raw) return res.status(400).json({error:"no raw tx"});

      const receipt = await web3.eth.sendSignedTransaction(raw);
      return res.json({ok:true, hash: receipt.transactionHash});
    }

    return res.status(400).json({error:"unknown action"});

  } catch (e) {
    return res.status(500).json({error:e.message});
  }
}