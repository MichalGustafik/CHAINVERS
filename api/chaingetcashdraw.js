console.log("=== BOOT: chaingetcashdraw.js LOADED ===");

import Web3 from "web3";

// ============================================================
// RPC FALLBACK SYSTEM
// ============================================================
const PRIMARY = process.env.PROVIDER_URL || "";
const FALLBACKS = [
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://base.blockpi.network/v1/rpc/public",
  "https://rpc.ankr.com/base"
];

async function initWeb3() {
  const rpcs = [PRIMARY, ...FALLBACKS];

  for (let rpc of rpcs) {
    if (!rpc) continue;

    console.log("[RPC] Trying:", rpc);

    try {
      const w3 = new Web3(rpc);
      await w3.eth.net.isListening();
      console.log("[RPC] SUCCESS:", rpc);
      return w3;
    } catch (e) {
      console.log("[RPC] FAIL:", rpc, e.message);
    }
  }

  throw new Error("No RPC works.");
}

// ============================================================
// ABI REQUIRED FOR WITHDRAW + BALANCE
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

  console.log("=== API CALL chaingetcashdraw ===");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    console.log("ENV PROVIDER_URL =", process.env.PROVIDER_URL);
    console.log("ENV CONTRACT_ADDRESS =", process.env.CONTRACT_ADDRESS);
    console.log("ENV PRIVATE_KEY (exists) =", !!process.env.PRIVATE_KEY);

    const web3 = await initWeb3();
    console.log("[INIT] Web3 initialized.");

    const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS);
    console.log("[INIT] Contract OK.");

    const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    console.log("[INIT] OWNER =", account.address);

    const action = req.query.action;
    console.log("[ACTION]", action);

    // ======================================================
    // BALANCE
    // ======================================================
    if (action === "balance") {
      const id = req.query.id;
      console.log("[BALANCE] id =", id);

      const isCopy = await contract.methods.copyToOriginal(id).call();
      console.log("[BALANCE] copyToOriginal =", isCopy);

      if (isCopy === "0") {
        const bal = await contract.methods.originBalance(id).call();
        console.log("[BALANCE] ORIGIN BAL =", bal);
        return res.json({ ok:true, type:"origin", balance:bal });
      } else {
        const bal = await contract.methods.copyBalance(id).call();
        console.log("[BALANCE] COPY BAL =", bal);
        return res.json({ ok:true, type:"copy", balance:bal });
      }
    }

    // ======================================================
    // WITHDRAW
    // ======================================================
    if (action === "withdraw") {
      let { id } = req.body;
      id = Number(id);

      console.log("[WITHDRAW] ID =", id);

      const isCopy = await contract.methods.copyToOriginal(id).call();
      console.log("[WITHDRAW] isCopy =", isCopy);

      const method =
        (isCopy === "0")
          ? contract.methods.withdrawOrigin(id)
          : contract.methods.withdrawCopy(id);

      console.log("[WITHDRAW] selected method:", isCopy === "0" ? "withdrawOrigin" : "withdrawCopy");

      let gas;
      try {
        gas = await method.estimateGas({ from: account.address });
        console.log("[GAS ESTIMATE] =", gas);
      } catch (e) {
        console.log("[GAS ERROR]", e.message);
        return res.json({ ok:false, error:"GAS_FAIL: " + e.message });
      }

      const tx = {
        from: account.address,
        to: process.env.CONTRACT_ADDRESS,
        gas,
        data: method.encodeABI()
      };

      console.log("[TX] Prepared:", tx);

      try {
        const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
        console.log("[TX] Signed.");

        const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);
        console.log("[TX] SENT:", sent.transactionHash);

        return res.json({
          ok:true,
          tx: sent.transactionHash,
          type: isCopy === "0" ? "origin" : "copy"
        });

      } catch (e) {
        console.log("[SEND ERROR]", e.message);
        return res.json({ ok:false, error:e.message });
      }
    }

    console.log("[ERROR] UNKNOWN ACTION");
    return res.json({ ok:false, error:"unknown action" });

  } catch (e) {
    console.log("[FATAL ERROR]", e.message);
    return res.json({ ok:false, error:e.message });
  }
}