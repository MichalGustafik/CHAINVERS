console.log("=== BOOT: WITHDRAW BACKEND (contract-level) ===");

import Web3 from "web3";

// ============================================================
// SAFE BODY PARSER FOR VERCEL
// ============================================================
async function parseBody(req) {
  return new Promise((resolve) => {
    try {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => {
        try {
          const json = JSON.parse(data || "{}");
          resolve(json);
        } catch {
          resolve({});
        }
      });
    } catch {
      resolve({});
    }
  });
}

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
    } catch (e) {
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

  // 💥 FIX: safe JSON parser
  const body = await parseBody(req);

  console.log("Parsed body:", body);

  try {
    const amount = body.amount;
    const userWallet = body.userWallet;

    if (!amount || !userWallet) {
      console.log("INVALID REQUEST:", body);
      return res.json({ ok:false, error:"Missing amount or wallet" });
    }

    console.log("Requested withdraw:", amount);
    console.log("User wallet:", userWallet);

    const web3 = await initWeb3();
    const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    const contractBalWei = await web3.eth.getBalance(process.env.CONTRACT_ADDRESS);
    const contractBal = Number(contractBalWei) / 1e18;

    console.log("Contract balance:", contractBal);

    if (Number(amount) > contractBal) {
      console.log("ERROR: amount > balance");
      return res.json({ ok:false, error:"not enough funds in contract" });
    }

    const method = contract.methods.withdraw();

    let gas;
    try {
      gas = await method.estimateGas({ from: owner.address });
    } catch (e) {
      console.log("GAS FAIL:", e.message);
      return res.json({ ok:false, error:"gas estimation fail: "+e.message });
    }

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
      withdrawn: amount,
      sentTo: userWallet
    });

  } catch (e) {
    console.log("FATAL:", e.message);
    return res.json({ ok:false, error:e.message });
  }
}