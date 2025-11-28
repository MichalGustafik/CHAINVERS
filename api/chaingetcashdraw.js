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

/* ======================= HANDLER ======================= */
export default async function handler(req, res) {

  try {
    const w3 = await initWeb3();
    const contract = new w3.eth.Contract(ABI, CONTRACT);

    const action   = req.query.action;
    const tokenId  = parseInt(req.query.tokenId || 0);
    const amount   = parseFloat(req.query.amount || 0);
    const gain     = parseFloat(req.query.gain || 0);   // prichádza z chaindraw.php
    const user     = req.query.user;

    if (!action || !user || !tokenId)
      return res.status(200).json({ status:"ERROR", error:"missing parameters" });

    /* ============================================
       PARTIAL WITHDRAW
       ============================================ */
    if (action === "withdrawAmount") {

      const MIN = 0.0001;

      if (amount < MIN)
        return res.status(200).json({ status:"ERROR", error:"too_small" });

      if (amount > gain)
        return res.status(200).json({ status:"ERROR", error:"too_much" });

      const valueWei = w3.utils.toWei(amount.toString(), "ether");

      // Gas balance check
      const gasBalance = await w3.eth.getBalance(FROM);
      if (BigInt(gasBalance) < 5000000000000n)
        return res.status(200).json({ status:"ERROR", error:"not_enough_gas" });

      // Prepare TX
      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM, value: valueWei });

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

      // VRACIAME JSON
      return res.status(200).json({
        status: "SUCCESS",
        tokenId: tokenId,
        withdrawn: amount,
        remaining: remaining,
        tx: receipt.transactionHash
      });
    }

    /* ============================================
       FULL WITHDRAW (BACKWARD COMPATIBLE)
       ============================================ */
    if (action === "withdraw") {

      const valueWei = w3.utils.toWei(gain.toString(), "ether");

      const tx = contract.methods.withdrawToken(tokenId);
      const gas = await tx.estimateGas({ from: FROM, value: valueWei });

      const signed = await w3.eth.accounts.signTransaction({
        to: CONTRACT,
        data: tx.encodeABI(),
        gas,
        from: FROM,
        value: valueWei
      }, PRIVATE_KEY);

      const result = await w3.eth.sendSignedTransaction(signed.rawTransaction);

      return res.status(200).json({
        status: "SUCCESS",
        tokenId: tokenId,
        withdrawn: gain,
        remaining: 0,
        tx: result.transactionHash
      });
    }

    return res.status(200).json({ status:"ERROR", error:"unknown_action" });

  } catch (e) {
    console.error("ERR:", e);
    return res.status(200).json({ status:"ERROR", error: e.message });
  }
}
