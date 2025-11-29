import Web3 from "web3";

const RPC = "https://mainnet.base.org";
const CONTRACT = process.env.CONTRACT_ADDRESS;

const ABI = [
  // essential read
  {"inputs":[],"name":"tokenIdCounter","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"ownerOf","outputs":[{"type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"copyToOriginal","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"type":"uint256"}],"name":"originBalance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},

  // withdrawOrigin
  {
    "inputs":[{"internalType":"uint256","name":"id","type":"uint256"}],
    "name":"withdrawOrigin",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

const web3 = new Web3(RPC);
const contract = new web3.eth.Contract(ABI, CONTRACT);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const action = req.query.action;

  try {

    /* ---------------------------------------------------------
       A1) RETURN ONLY ORIGIN TOKENS USER OWNS
    ----------------------------------------------------------*/
    if (action === "listTokens") {
      const wallet = req.query.wallet?.toLowerCase();
      if (!wallet) return res.json({ tokens: [] });

      const counter = await contract.methods.tokenIdCounter().call();
      let tokens = [];

      for (let id = 1; id < counter; id++) {
        try {
          const owner = (await contract.methods.ownerOf(id).call()).toLowerCase();
          if (owner !== wallet) continue;

          const parent = await contract.methods.copyToOriginal(id).call();
          if (parent != 0) continue; // skip copy

          tokens.push(id);
        } catch (err) {
          // ignore invalid ids
        }
      }

      return res.json({ tokens });
    }

    /* ---------------------------------------------------------
       A2) GET ORIGIN BALANCE
    ----------------------------------------------------------*/
    if (action === "getBalance") {
      const id = req.query.id;
      const bal = await contract.methods.originBalance(id).call();
      return res.json({ balance: bal });
    }

    /* ---------------------------------------------------------
       A3) PREPARE RAW WITHDRAW TX (user signs)
    ----------------------------------------------------------*/
    if (action === "prepareWithdraw") {
      const id = req.body.id;
      const from = req.body.wallet;

      const txData = contract.methods.withdrawOrigin(id).encodeABI();

      const tx = {
        from,
        to: CONTRACT,
        data: txData,
        gas: 150000
      };

      return res.json({ tx });
    }

    /* ---------------------------------------------------------
       A4) BROADCAST SIGNED TX
    ----------------------------------------------------------*/
    if (action === "broadcast") {
      const raw = req.body.signedTx;
      const receipt = await web3.eth.sendSignedTransaction(raw);
      return res.json({ ok: true, hash: receipt.transactionHash });
    }

    return res.json({ error: "unknown action" });

  } catch (e) {
    return res.json({ error: e.message });
  }
}