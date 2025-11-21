// CHAINVERS – chaingetcash.js (FINAL PRODUCTION FOR BASE MAINNET)
// - Web3.js (raw TX signing) – 100% kompatibilné s Base Mainnet
// - mintCopy + automatic safeTransferFrom → user_address
// - avoids estimateGas failures
// - correct mintFee logic
// - supports editable EUR price → converted to ETH
// - logs everything for ACCEPTPAY

import Web3 from "web3";
import fetch from "node-fetch";

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const {
    action,
    payment_id,
    user_address,
    token_id,
    amount_eur,
    user_folder,
  } = req.body;

  if (action !== "mint") {
    return res.status(400).json({ error: "Unknown action" });
  }

  //---------------------------------------------------------
  // ENV
  //---------------------------------------------------------
  const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

  if (!RPC_URL || !PRIVATE_KEY || !FROM || !CONTRACT_ADDRESS) {
    return res.status(500).json({
      error: "Missing ENV RPC_URL, PRIVATE_KEY, FROM_ADDRESS, CONTRACT_ADDRESS",
    });
  }

  const web3 = new Web3(RPC_URL);

  //---------------------------------------------------------
  // ABI PRE MINTCOPY + TRANSFER
  //---------------------------------------------------------
  const ABI = [
    {
      name: "mintFee",
      type: "function",
      inputs: [],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    },
    {
      name: "mintCopy",
      type: "function",
      inputs: [{ name: "originalId", type: "uint256" }],
      outputs: [],
      stateMutability: "payable",
    },
    {
      name: "safeTransferFrom",
      type: "function",
      inputs: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "tokenId", type: "uint256" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ];

  const contract = new web3.eth.Contract(ABI, CONTRACT_ADDRESS);

  //---------------------------------------------------------
  // GET MINT FEE
  //---------------------------------------------------------
  const mintFeeWei = await contract.methods.mintFee().call();
  let valueWei = web3.utils.toBN(mintFeeWei);

  //---------------------------------------------------------
  // EUR → ETH KONVERZIA (ak amount_eur > 0)
  //---------------------------------------------------------
  if (amount_eur > 0) {
    try {
      const r = await fetch(
        "https://api.coinbase.com/v2/prices/ETH-EUR/spot"
      );
      const priceJson = await r.json();
      const ethPrice = parseFloat(priceJson.data.amount);

      let ethAmount = amount_eur / ethPrice;
      let customWei = web3.utils.toBN(
        web3.utils.toWei(ethAmount.toString(), "ether")
      );

      if (customWei.gt(valueWei)) {
        valueWei = customWei;
      }
    } catch (e) {
      log("❌ EUR→ETH prepočet failed, používam mintFee");
    }
  }

  //---------------------------------------------------------
  // STEP 1: SEND MINTCOPY TRANSACTION
  //---------------------------------------------------------
  log("🔥 MINTCOPY START for token_id:", token_id);

  const mintData = contract.methods.mintCopy(token_id).encodeABI();

  const nonceMint = await web3.eth.getTransactionCount(FROM, "pending");
  const gasPrice = await web3.eth.getGasPrice();

  const mintTx = {
    from: FROM,
    to: CONTRACT_ADDRESS,
    nonce: nonceMint,
    gasPrice: web3.utils.toHex(gasPrice),
    gas: web3.utils.toHex(350000), // pevný gas limit aby nepadlo estimateGas
    value: valueWei.toString(),
    data: mintData,
  };

  const signedMint = await web3.eth.accounts.signTransaction(
    mintTx,
    PRIVATE_KEY
  );

  let mintReceipt;
  try {
    mintReceipt = await web3.eth.sendSignedTransaction(
      signedMint.rawTransaction
    );
  } catch (err) {
    log("❌ MINTCOPY ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }

  log("✅ MINTCOPY TX:", mintReceipt.transactionHash);

  //---------------------------------------------------------
  // ZÍSKAŤ NOVÝ TOKEN ID (z Transfer eventu)
  //---------------------------------------------------------
  let newTokenId = null;
  if (mintReceipt.logs && mintReceipt.logs.length > 0) {
    for (const logEntry of mintReceipt.logs) {
      if (
        logEntry.topics &&
        logEntry.topics[0] ===
          web3.utils.sha3(
            "Transfer(address,address,uint256)"
          )
      ) {
        // topics[3] = tokenId
        newTokenId = web3.utils.hexToNumberString(
          logEntry.topics[3]
        );
      }
    }
  }

  if (!newTokenId) {
    return res.status(500).json({
      error: "Mint succeeded but tokenId not found",
      txHash: mintReceipt.transactionHash,
    });
  }

  log("🎯 NEW TOKEN ID:", newTokenId);

  //---------------------------------------------------------
  // STEP 2: AUTOMATIC SAFE TRANSFER TO USER_ADDRESS
  //---------------------------------------------------------
  log("🚀 TRANSFERRING NFT TO USER:", user_address);

  const transferData = contract.methods
    .safeTransferFrom(FROM, user_address, newTokenId)
    .encodeABI();

  const nonceTransfer = nonceMint + 1;

  const transferTx = {
    from: FROM,
    to: CONTRACT_ADDRESS,
    nonce: nonceTransfer,
    gasPrice: web3.utils.toHex(gasPrice),
    gas: web3.utils.toHex(300000),
    value: "0x0",
    data: transferData,
  };

  const signedTransfer = await web3.eth.accounts.signTransaction(
    transferTx,
    PRIVATE_KEY
  );

  let transferReceipt;
  try {
    transferReceipt = await web3.eth.sendSignedTransaction(
      signedTransfer.rawTransaction
    );
  } catch (e) {
    log("❌ TRANSFER ERROR:", e.message);
    return res.status(500).json({
      success: false,
      error: "Transfer failed",
      mintTx: mintReceipt.transactionHash,
      message: e.message,
    });
  }

  //---------------------------------------------------------
  // DONE
  //---------------------------------------------------------
  log("✔ COMPLETE. NFT TRANSFERRED:", newTokenId);

  return res.status(200).json({
    success: true,
    mintTx: mintReceipt.transactionHash,
    transferTx: transferReceipt.transactionHash,
    tokenId: newTokenId,
    owner: user_address,
  });
}