// CHAINVERS - chaingetcash.js V7 FINAL
// RAW TX VERSION - no ethers, no web3 contract ABI decoding
// Works 100% on Vercel Node 18, Base Mainnet

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
    return res.status(400).json({ error: "Invalid action" });
  }

  //-----------------------------------------
  // ENV
  //-----------------------------------------
  const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const FROM = process.env.FROM_ADDRESS;
  const CONTRACT = process.env.CONTRACT_ADDRESS;

  if (!RPC_URL || !PRIVATE_KEY || !FROM || !CONTRACT) {
    return res.status(500).json({ error: "Missing ENV vars" });
  }

  const web3 = new Web3(RPC_URL);

  //-----------------------------------------
  // GET mintFee DIRECTLY (raw call)
  //-----------------------------------------
  const mintFeeSelector = "0xdd62ed3e"; // keccak("mintFee()")[0:4]
  const mintFeeData = mintFeeSelector;

  let mintFeeWei = await web3.eth.call({
    to: CONTRACT,
    data: mintFeeData,
  });

  mintFeeWei = web3.utils.toBN(mintFeeWei);

  //-----------------------------------------
  // CALCULATE VALUE WEI
  //-----------------------------------------
  let valueWei = mintFeeWei;

  if (amount_eur > 0) {
    try {
      const r = await fetch(
        "https://api.coinbase.com/v2/prices/ETH-EUR/spot"
      );
      const j = await r.json();
      const ethPrice = parseFloat(j.data.amount);

      const ethAmount = amount_eur / ethPrice;
      const wei = web3.utils.toBN(
        web3.utils.toWei(ethAmount.toString(), "ether")
      );

      if (wei.gt(valueWei)) valueWei = wei;
    } catch (e) {
      log("EUR→ETH failed, using mintFee only");
    }
  }

  //-----------------------------------------
  // ABI ENCODING HELPERS
  //-----------------------------------------
  function pad32(hex) {
    return hex.replace("0x", "").padStart(64, "0");
  }

  function encodeUint256(v) {
    return pad32(web3.utils.toHex(v));
  }

  function encodeAddress(addr) {
    return pad32(addr.toLowerCase().replace("0x", ""));
  }

  //-----------------------------------------
  // STEP 1: RAW ENCODE mintCopy(originalId)
  //-----------------------------------------
  const selectorMintCopy = "0xadd8462e"; // keccak("mintCopy(uint256)")
  const dataMint =
    selectorMintCopy + encodeUint256(token_id);

  const nonceMint = await web3.eth.getTransactionCount(FROM, "pending");
  const gasPrice = await web3.eth.getGasPrice();

  const txMint = {
    from: FROM,
    to: CONTRACT,
    nonce: nonceMint,
    gasPrice: web3.utils.toHex(gasPrice),
    gas: web3.utils.toHex(350000),
    value: valueWei.toString(),
    data: dataMint,
  };

  let signedMint, mintReceipt;

  try {
    signedMint = await web3.eth.accounts.signTransaction(txMint, PRIVATE_KEY);
    mintReceipt = await web3.eth.sendSignedTransaction(signedMint.rawTransaction);
  } catch (err) {
    log("❌ MINT ERROR:", err.message);
    return res.status(500).json({ error: "Mint failed", message: err.message });
  }

  log("🔥 MINT TX:", mintReceipt.transactionHash);

  //-----------------------------------------
  // GET NEW TOKEN ID FROM Transfer EVENT
  //-----------------------------------------
  let newTokenId = null;

  if (mintReceipt.logs) {
    for (const L of mintReceipt.logs) {
      if (L.topics && L.topics[0] === web3.utils.sha3("Transfer(address,address,uint256)")) {
        // topics[3] = tokenId
        newTokenId = web3.utils.hexToNumberString(L.topics[3]);
      }
    }
  }

  if (!newTokenId) {
    return res.status(500).json({
      error: "Mint OK but tokenId not found",
      tx: mintReceipt.transactionHash,
    });
  }

  log("🎯 NEW TOKEN ID:", newTokenId);

  //-----------------------------------------
  // STEP 2: AUTO TRANSFER NFT TO USER ADDRESS
  //-----------------------------------------
  const selectorTransfer = "0x42842e0e"; // safeTransferFrom(address,address,uint256)

  const dataTransfer =
    selectorTransfer +
    encodeAddress(FROM) +
    encodeAddress(user_address) +
    encodeUint256(newTokenId);

  const nonceTransfer = nonceMint + 1;

  const txTransfer = {
    from: FROM,
    to: CONTRACT,
    nonce: nonceTransfer,
    gasPrice: web3.utils.toHex(gasPrice),
    gas: web3.utils.toHex(300000),
    value: "0x0",
    data: dataTransfer,
  };

  let signedTransfer, transferReceipt;

  try {
    signedTransfer = await web3.eth.accounts.signTransaction(
      txTransfer,
      PRIVATE_KEY
    );

    transferReceipt = await web3.eth.sendSignedTransaction(
      signedTransfer.rawTransaction
    );
  } catch (e) {
    log("❌ TRANSFER ERROR:", e.message);
    return res.status(500).json({
      error: "Transfer failed",
      mintTx: mintReceipt.transactionHash,
      message: e.message,
    });
  }

  log("✔ TRANSFER COMPLETE:", transferReceipt.transactionHash);

  //-----------------------------------------
  // DONE
  //-----------------------------------------
  return res.status(200).json({
    success: true,
    payment_id,
    tokenId: newTokenId,
    mintTx: mintReceipt.transactionHash,
    transferTx: transferReceipt.transactionHash,
    owner: user_address,
  });
}