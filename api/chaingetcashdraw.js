console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (NO TOKEN-ID MODE) ===");

import Web3 from "web3";

/* ============================================================
   SAFE BODY PARSER
============================================================ */
async function parseBody(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch { resolve({}); }
    });
  });
}

/* ============================================================
   RPC FALLBACK
============================================================ */
const RPCs = [
  process.env.PROVIDER_URL,
  "https://base.llamarpc.com",
  "https://base.publicnode.com",
  "https://base.blockpi.network/v1/rpc/public",
  "https://rpc.ankr.com/base"
].filter(Boolean);

async function initWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("[RPC OK]", rpc);
      return w3;
    } catch (e) {
      console.log("[RPC FAIL]", rpc, e.message);
    }
  }
  throw new Error("No working RPC");
}

/* ============================================================
   ONLY ABI WE NEED → backendWithdraw(address,uint256)
============================================================ */
const ABI = [
  {
    "inputs":[
      {"internalType":"address","name":"to","type":"address"},
      {"internalType":"uint256","name":"amount","type":"uint256"}
    ],
    "name":"backendWithdraw",
    "outputs":[],
    "stateMutability":"nonpayable",
    "type":"function"
  }
];

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  console.log("=== API CALL chaingetcashdraw ===");

  const body = await parseBody(req);
  const action = body.action || "none";
  console.log("ACTION:", action);

  try {
    const web3 = await initWeb3();
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contract = new web3.eth.Contract(ABI, contractAddr);

    const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
    web3.eth.accounts.wallet.add(owner);

    /* --------------------------------------------------------
       ACTION: withdraw
       POST {
         action:"withdraw",
         user:"0x1234...",
         amount:0.01
       }
    -------------------------------------------------------- */
    if (action === "withdraw") {

      const user   = body.user;
      const amount = Number(body.amount);

      if (!user || !user.startsWith("0x")) {
        return res.json({ ok:false, error:"Invalid user address" });
      }
      if (amount <= 0) {
        return res.json({ ok:false, error:"Amount must be > 0" });
      }

      console.log("[WITHDRAW] user =", user, "amount =", amount);

      const weiFull = BigInt(web3.utils.toWei(amount.toString(), "ether"));

      // --- 1. Gas estimation ---
      const gas = await contract.methods.backendWithdraw(user, weiFull.toString())
        .estimateGas({ from: owner.address });

      const gasPrice = BigInt(await web3.eth.getGasPrice());
      const gasCost  = BigInt(gas) * gasPrice;

      console.log("[GAS] gas =", gas, "gasPrice =", gasPrice.toString(), "gasCost =", gasCost.toString());

      // --- 2. Final amount after gas deduction ---
      const weiFinal = weiFull - gasCost;
      if (weiFinal <= 0n) {
        return res.json({ ok:false, error:"Zadaná suma nepokryje gas. Zadaj viac." });
      }

      console.log("[FINAL AMOUNT]", weiFinal.toString(), "wei");

      // --- 3. Execute backendWithdraw ---
      const method = contract.methods.backendWithdraw(user, weiFinal.toString());

      const tx = await method.send({
        from: owner.address,
        gas
      });

      console.log("[TX]", tx.transactionHash);

      return res.json({
        ok:true,
        tx: tx.transactionHash,
        finalAmountWei: weiFinal.toString()
      });
    }

    return res.json({ ok:false, error:"Unknown action" });

  } catch (e) {
    console.log("[FATAL]", e.message);
    return res.json({ ok:false, error:e.message });
  }
}