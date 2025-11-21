// /api/chaingetcash.js
import { ethers } from "ethers";
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const {
      payment_id,
      user_address,
      token_id,
      amount_eur
    } = req.body;

    // ------------------------------
    // ENV VARS – KONTRAKT AUTOMATICKY
    // ------------------------------
    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;        // wallet for minting
    const RPC_URL = process.env.RPC_URL;                // Base or Base Sepolia
    const CALLBACK_URL = process.env.CALLBACK_URL;      // accptpay.php handler

    if (!CONTRACT_ADDRESS)
      throw new Error("Missing CONTRACT_ADDRESS in Vercel ENV.");

    // ------------------------------
    // PROVIDER + SIGNER
    // ------------------------------
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // ------------------------------
    // KONTRAKT ABI
    // ------------------------------
    const ABI = [
      "function createOriginal(string,string,uint96,uint256) payable",
      "function mintCopy(uint256) payable",
      "function mintFee() view returns (uint256)"
    ];

    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    // ------------------------------
    // ZISTÍME MINT FEE
    // ------------------------------
    const mintFee = await contract.mintFee();
    console.log("Mint fee:", mintFee.toString());

    // ------------------------------
    // GET ETH PRICE
    // ------------------------------
    const priceRes = await fetch("https://api.coinbase.com/v2/prices/ETH-EUR/spot");
    const priceJson = await priceRes.json();
    const ethPrice = parseFloat(priceJson.data.amount);

    // EUR → ETH
    const ethAmount = (amount_eur / ethPrice).toFixed(6);

    // ------------------------------
    // Vykonáme MINT
    // ------------------------------
    let tx;

    if (!token_id || token_id === 0) {
      // mint ORIGINAL
      tx = await contract.createOriginal(
        "privateURI",
        "publicURI",
        500,       // 5% royalty
        1000,      // maxCopies
        { value: mintFee }
      );
    } else {
      // mint COPY
      tx = await contract.mintCopy(token_id, { value: mintFee });
    }

    const receipt = await tx.wait();
    console.log("TX HASH:", receipt.hash);

    // ------------------------------
    // CALLBACK DO accptpay.php
    // ------------------------------
    await fetch(CALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_id,
        token_id,
        txHash: receipt.hash,
        ethAmount
      })
    });

    return res.status(200).json({
      success: true,
      txHash: receipt.hash,
      contract: CONTRACT_ADDRESS
    });

  } catch (err) {
    console.error("chaingetcash ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}