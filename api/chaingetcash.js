import pkg from "ethers";
const { providers, Wallet, Contract } = pkg;

export default async function handler(req, res) {
  try {
    const action = req.body?.action || req.query?.action;

    if (action === "mint") {
      return await mintHandler(req, res);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

async function mintHandler(req, res) {
  const {
    payment_id,
    user_address,
    token_id,
    amount_eur,
    user_folder
  } = req.body;

  const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

  if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    return res.status(500).json({ error: "Missing ENV" });
  }

  const provider = new providers.JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);

  const ABI = [
    "function createOriginal(string,string,uint96,uint256) payable",
    "function mintCopy(uint256) payable",
    "function mintFee() view returns(uint256)"
  ];

  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

  const mintFee = await contract.mintFee();

  let value = mintFee;

  if (amount_eur > 0) {
    // convert EUR to ETH?
    value = mintFee; // zatiaľ minimálna logika (doplni sa)
  }

  let tx;

  if (!token_id || token_id == 0) {
    tx = await contract.createOriginal(
      "uri1",
      "uri2",
      500,
      1000,
      { value }
    );
  } else {
    tx = await contract.mintCopy(token_id, { value });
  }

  const receipt = await tx.wait();

  return res.status(200).json({
    success: true,
    txHash: receipt.hash,
    payment_id,
    user_folder
  });
}