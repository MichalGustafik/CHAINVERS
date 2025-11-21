// CHAINVERS – chaingetcash.js (FINAL VERCEL VERSION)
// Fix pre Vercel: ethers sa importuje ako CommonJS default

import pkg from "ethers";
const { JsonRpcProvider, Wallet, Contract } = pkg;

// FETCH pre Node
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const action = req.body?.action || req.query.action;

    if (action === "mint") {
      return await handleMint(req, res);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (e) {
    console.error("SERVER ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
}

async function handleMint(req, res) {
  const {
    payment_id,
    user_address,
    token_id,
    amount_eur,
    user_folder
  } = req.body;

  // ENV
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

  if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    return res.status(500).json({ error: "Missing ENV variables" });
  }

  // ETHERS v6 – CommonJS import
  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);

  const ABI = [
    "function createOriginal(string,string,uint96,uint256) payable",
    "function mintCopy(uint256) payable",
    "function mintFee() view returns(uint256)"
  ];

  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  // MINT FEE
  const mintFee = await contract.mintFee();

  let tx;

  if (!token_id || token_id === 0) {
    // originál
    tx = await contract.createOriginal(
      "privateURI",
      "publicURI",
      500,
      1000,
      { value: mintFee }
    );
  } else {
    // kópia
    tx = await contract.mintCopy(token_id, { value: mintFee });
  }

  const receipt = await tx.wait();

  return res.status(200).json({
    success: true,
    txHash: receipt.hash,
    payment_id,
    user_folder
  });
}