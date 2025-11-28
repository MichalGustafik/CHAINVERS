import Web3 from "web3";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;

/* ======================= RPC FALLBACK ======================= */
const RPCs = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

async function initWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      return w3;
    } catch (e) {}
  }
  throw new Error("All RPCs failed.");
}

/* ======================= ABI ======================= */
const ABI = [
  {
    "inputs":[{"internalType":"uint256","name":"tokenId","type":"uint256"}],
    "name":"withdrawToken",
    "outputs":[],
    "stateMutability":"payable",
    "type":"function"
  }
];

/* ======================= MAIN HANDLER ======================= */
export default async function handler(req, res) {

  try {
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);

    const action   = req.query.action;
    const tokenId  = parseInt(req.query.tokenId ?? 0);
    const amount   = parseFloat(req.query.amount ?? 0);
    const gain     = parseFloat(req.query.gain ?? 0);
    const user     = req.query.user;

    if (!action || !user || !tokenId)
      return res.status(200).json({ status:"ERROR", error:"missing_parameters" });

    /* ==========================================================
       PARTIAL WITHDRAW (NEČÍTA ORDERS.JSON!)
       ========================================================== */
    if (action === "withdrawAmount") {

      const MIN = 0.0001;
      if (amount < MIN)
        return res.status(200).json({ status:"ERROR", error:"amount_too_small" });

      if (amount > gain)
        return res.status(200).json({ status:"ERROR", error:"amount_exceeds_gain" });

      // Prevod na wei
      const valueWei = w3.utils.toWei(amount.toString(), "ether");

      // Gas check
      const gasBalance = await w3.eth.getBalance(FROM);
      if (BigInt(gasBalance) < 5000000000000n)
        return res.status(200).json({ status:"ERROR", error:"gas_low" });

      const tx = contract.methods.withdrawToken(tokenId);

      const gas = await tx.estimateGas({
        from: FROM,
        value: valueWei
      });

      const signed = await w3.eth.accounts.signTransaction(
        {
          to: CONTRACT,
          data: tx.encodeABI(),
          gas: gas,
          from: FROM,
          value: valueWei
        },
        PRIVATE_KEY
      );

      const receipt = await w3.eth.sendSignedTransaction(signed.rawTransaction);

      const remaining = parseFloat((gain - amount).toFixed(6));

      return res.status(200).json({
        status: "SUCCESS",
        tokenId,
        withdrawn: amount,
        remaining,
        tx: receipt.transactionHash
      });
    }

    return res.status(200).json({ status:"ERROR", error:"unknown_action" });

  } catch (e) {
    console.error("ERR:", e);
    return res.status(200).json({ status:"ERROR", error: e.message });
  }
}