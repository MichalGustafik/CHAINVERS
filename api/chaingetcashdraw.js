console.log("=== BOOT: WITHDRAW BACKEND (contract-level) ===");

import Web3 from "web3";

// ============================================================
// RPC FALLBACK
// ============================================================
const PRIMARY = process.env.PROVIDER_URL;
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
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("[RPC] OK:", rpc);
      return w3;
    } catch(e) {
      console.log("[RPC] FAIL:", rpc, e.message);
    }
  }
  throw new Error("No working RPC");
}

// ============================================================
// ABI – only withdraw()
// ============================================================
const ABI = [
  {
    "inputs": [],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {

  console.log("=== API CALL: CONTRACT WITHDRAW ===");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  try {
    const { amount, userWallet } = req.body;

    console.log("Requested withdraw:", amount, "ETH");
    console.log("User wallet:", userWallet);

    const web3 = await initWeb3();
    const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    const contractBalWei = await web3.eth.getBalance(process.env.CONTRACT_ADDRESS);
    const contractBal = Number(contractBalWei) / 1e18;

    console.log("Contract balance:", contractBal, "ETH");

    // LIMIT
    if (Number(amount) > contractBal) {
      console.log("ERROR: amount > contract balance");
      return res.json({ ok:false, error:"not enough funds in contract" });
    }

    // SEND TX
    const method = contract.methods.withdraw();
    const gas = await method.estimateGas({ from: owner.address });

    console.log("Gas:", gas);

    const tx = {
      from: owner.address,
      to: process.env.CONTRACT_ADDRESS,
      gas,
      data: method.encodeABI()
    };

    const signed = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    console.log("TX HASH:", sent.transactionHash);

    return res.json({
      ok: true,
      tx: sent.transactionHash,
      sentTo: userWallet,
      withdrawn: amount
    });

  } catch(e) {
    console.log("FATAL:", e.message);
    return res.json({ ok:false, error:e.message });
  }
}