import Web3 from "web3";

// ============================================================
//  RPC FALLBACKS (primárny z ENV, ostatné automaticky ako backup)
// ============================================================
const PRIMARY_RPC = process.env.PROVIDER_URL;

const FALLBACK_RPCS = [
  "https://base.llamarpc.com",
  "https://base.blockpi.network/v1/rpc/public",
  "https://base.publicnode.com",
  "https://rpc.ankr.com/base"
];

// ============================================================
function createWeb3Instance(rpc) {
  return new Web3(new Web3.providers.HttpProvider(rpc, {
    timeout: 12000,
  }));
}

// ============================================================
//   SAFE WEB3 INITIALIZER (tries ENV → fallback 1 → fallback 2 → ...)
// ============================================================
async function initWeb3() {
  const rpcList = [PRIMARY_RPC, ...FALLBACK_RPCS];

  for (let rpc of rpcList) {
    try {
      const w3 = createWeb3Instance(rpc);
      await w3.eth.net.isListening();
      console.log("RPC OK:", rpc);
      return w3;
    } catch (e) {
      console.log("RPC FAIL:", rpc);
    }
  }

  throw new Error("No working RPC endpoint available.");
}

// ============================================================
// ABI (origin/copy withdraw kontrakt CHAINVERS)
// ============================================================
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


// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {

    // INIT WEB3 S FALLBACKOM
    const web3 = await initWeb3();
    const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS);

    // LOAD OWNER WALLET
    const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);

    const action = req.query.action;

    // ========================================================
    // BALANCE REQUEST
    // ========================================================
    if (action === "balance") {
      const id = req.query.id;

      let isCopy = await contract.methods.copyToOriginal(id).call();

      if (isCopy === "0") {
        const bal = await contract.methods.originBalance(id).call();
        return res.json({ ok:true, type:"origin", balance:bal });
      } else {
        const bal = await contract.methods.copyBalance(id).call();
        return res.json({ ok:true, type:"copy", balance:bal });
      }
    }

    // ========================================================
    // WITHDRAW (COPYMINT OPAČNE)
    // ========================================================
    if (action === "withdraw") {

      let { id } = req.body;
      id = Number(id);

      let isCopy = await contract.methods.copyToOriginal(id).call();

      const method =
        (isCopy === "0")
          ? contract.methods.withdrawOrigin(id)
          : contract.methods.withdrawCopy(id);

      // GAS ESTIMATE
      const gas = await method.estimateGas({ from: account.address });

      // TX
      const tx = {
        from: account.address,
        to: process.env.CONTRACT_ADDRESS,
        gas,
        data: method.encodeABI()
      };

      const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
      const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.json({
        ok:true,
        tx: sent.transactionHash,
        type: isCopy === "0" ? "origin" : "copy"
      });
    }

    return res.json({ ok:false, error:"unknown action" });

  } catch (e) {
    return res.json({ ok:false, error:e.message });
  }
}