// ============================================
// FILE: /api/copymint.js
// ============================================

import Web3 from "web3";

export const maxDuration = 60;

/* ============================================
   ABI
============================================ */

const ABI = [

  // mintCopy
  {
    inputs: [
      {
        internalType: "uint256",
        name: "originalId",
        type: "uint256"
      }
    ],
    name: "mintCopy",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },

  // mintFee
  {
    inputs: [],
    name: "mintFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },

  // tokenURI
  {
    inputs: [
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256"
      }
    ],
    name: "tokenURI",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },

  // backendWithdraw
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "backendWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];

/* ============================================
   HELPERS
============================================ */

function setCors(res){

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function cleanPrivateKey(pk){

  if (!pk) {
    return "";
  }

  pk =
    String(pk).trim();

  return pk.startsWith("0x")
    ? pk
    : "0x" + pk;
}

function cleanAddress(addr){

  return String(addr || "")
    .trim()
    .toLowerCase();
}

function ipfsToHttp(url){

  if (!url) {
    return "";
  }

  url =
    String(url).trim();

  if (url.startsWith("ipfs://ipfs/")) {

    return (
      "https://gateway.pinata.cloud/ipfs/" +
      url.replace("ipfs://ipfs/", "")
    );
  }

  if (url.startsWith("ipfs://")) {

    return (
      "https://gateway.pinata.cloud/ipfs/" +
      url.replace("ipfs://", "")
    );
  }

  return url;
}

async function fetchJson(url){

  const r =
    await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

  const text =
    await r.text();

  try {

    return JSON.parse(text);

  } catch {

    return {
      raw: text
    };
  }
}

async function fetchText(url){

  const r =
    await fetch(url);

  return await r.text();
}

async function userAlreadyHasCopy(
  userAddress,
  originalId
){

  const cleanUser =
    cleanAddress(userAddress);

  const url =
    "https://chainvers.free.nf/chainuserdata/" +
    cleanUser +
    "/copymint.json?_=" +
    Date.now();

  console.log(
    "CHECK COPY URL =",
    url
  );

  try {

    const text =
      await fetchText(url);

    let json = [];

    try {

      json =
        JSON.parse(text);

    } catch {

      console.log(
        "COPY JSON PARSE FAILED"
      );

      return false;
    }

    if (!Array.isArray(json)) {
      return false;
    }

    for (const copy of json){

      const copyUser =
        cleanAddress(
          copy?.user_address || ""
        );

      const copyOriginal =
        String(
          copy?.original_id || ""
        );

      const status =
        String(
          copy?.status || ""
        ).toLowerCase();

      if (
        copyUser === cleanUser
        &&
        copyOriginal === String(originalId)
        &&
        !status.includes("failed")
        &&
        !status.includes("rollback")
        &&
        !status.includes("cancel")
      ){

        console.log(
          "COPY ALREADY EXISTS"
        );

        return true;
      }
    }

    return false;

  } catch (e){

    console.error(
      "COPY CHECK ERROR =",
      e
    );

    return false;
  }
}

/* ============================================
   HANDLER
============================================ */

export default async function handler(req, res){

  setCors(res);

  console.log("=== COPYMINT API START ===");
  console.log("METHOD =", req.method);
  console.log("BODY =", req.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {

    return res.status(200).json({
      ok: true,
      endpoint: "copymint",
      status: "alive"
    });
  }

  try {

    if (req.method !== "POST") {

      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const {
      action,
      original_id,
      user_address,
      withdraw_to,
      amount_eth,
      token_id
    } = req.body || {};

    if (!action) {

      return res.status(400).json({
        ok: false,
        error: "Missing action"
      });
    }

    /* ============================================
       ENV
    ============================================ */

    const rpc =
      process.env.PROVIDER_URL;

    const pk =
      cleanPrivateKey(
        process.env.PRIVATE_KEY
      );

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    if (!rpc) {

      return res.status(500).json({
        ok: false,
        error: "Missing PROVIDER_URL"
      });
    }

    if (!contractAddress) {

      return res.status(500).json({
        ok: false,
        error: "Missing CONTRACT_ADDRESS"
      });
    }

    if (!pk) {

      return res.status(500).json({
        ok: false,
        error: "Missing PRIVATE_KEY"
      });
    }

    const web3 =
      new Web3(rpc);

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    const account =
      web3.eth.accounts.privateKeyToAccount(pk);

    web3.eth.accounts.wallet.add(account);

    console.log(
      "BACKEND ADDRESS =",
      account.address
    );

    /* ============================================
       ACTION: scan_preview
    ============================================ */

    if (action === "scan_preview") {

      const id =
        token_id || original_id;

      if (!id) {

        return res.status(400).json({
          ok: false,
          error: "Missing token_id"
        });
      }

      console.log(
        "SCAN PREVIEW TOKEN =",
        id
      );

      let tokenUri = "";

      try {

        tokenUri =
          await contract.methods
            .tokenURI(id)
            .call();

      } catch (e) {

        console.error(
          "TOKEN URI ERROR =",
          e
        );

        return res.status(500).json({
          ok: false,
          error:
            "tokenURI failed: " +
            e.message
        });
      }

      const metadataUrl =
        ipfsToHttp(tokenUri);

      let metadata = null;

      try {

        metadata =
          await fetchJson(metadataUrl);

      } catch (e) {

        return res.status(500).json({
          ok: false,
          error:
            "metadata fetch failed: " +
            e.message
        });
      }

      let image =
        metadata?.image ||
        metadata?.image_url ||
        metadata?.animation_url ||
        metadata?.properties?.image ||
        "";

      image =
        ipfsToHttp(image);

      return res.status(200).json({
        ok: true,
        action: "scan_preview",
        token_id: String(id),
        token_uri: tokenUri,
        metadata_url: metadataUrl,
        image,
        metadata
      });
    }

    /* ============================================
       MINT FEE
    ============================================ */

    let mintFeeWei = "0";

    try {

      mintFeeWei =
        await contract.methods
          .mintFee()
          .call();

    } catch {

      mintFeeWei =
        web3.utils.toWei(
          "0.0002",
          "ether"
        );
    }

    /* ============================================
       ACTION: wallet_prepare
    ============================================ */

    if (action === "wallet_prepare") {

      if (
        !original_id ||
        !user_address
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Missing original_id or user_address"
        });
      }

      const alreadyHasCopy =
        await userAlreadyHasCopy(
          user_address,
          original_id
        );

      if (alreadyHasCopy){

        return res.status(409).json({
          ok: false,
          error: "already_has_copy",
          message:
            "Tento používateľ už má CopyMint z tohto origin NFT."
        });
      }

      return res.json({
        ok: true,
        action: "wallet_prepare",
        contract_address: contractAddress,
        original_id,
        user_address,
        mint_fee_wei: mintFeeWei
      });
    }

    /* ============================================
       ACTION: mint_from_balance
    ============================================ */

    if (action === "mint_from_balance") {

      if (
        !original_id ||
        !user_address
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Missing original_id or user_address"
        });
      }

      const alreadyHasCopy =
        await userAlreadyHasCopy(
          user_address,
          original_id
        );

      if (alreadyHasCopy){

        return res.status(409).json({
          ok: false,
          error: "already_has_copy",
          message:
            "Tento používateľ už má CopyMint z tohto origin NFT."
        });
      }

      console.log(
        "MINT COPY START"
      );

      const txCall =
        contract.methods
          .mintCopy(original_id);

      const balanceWei =
        await web3.eth.getBalance(
          account.address
        );

      const gasPrice =
        await web3.eth.getGasPrice();

      const estimatedGasCostWei =
        BigInt(gasPrice) * 300000n;

      const totalNeededWei =
        BigInt(mintFeeWei) +
        estimatedGasCostWei;

      if (
        BigInt(balanceWei)
        <
        totalNeededWei
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Backend wallet nemá dosť ETH.",
          backend_balance_wei:
            balanceWei,
          total_needed_wei:
            totalNeededWei.toString()
        });
      }

      const gas =
        await txCall
          .estimateGas({
            from: account.address,
            value: mintFeeWei
          });

      const gasLimit =
        Math.ceil(
          Number(gas) * 1.25
        );

      const nonce =
        await web3.eth.getTransactionCount(
          account.address,
          "pending"
        );

      const signed =
        await web3.eth.accounts.signTransaction(
          {
            from: account.address,
            to: contractAddress,
            data: txCall.encodeABI(),
            value: mintFeeWei,
            gas: gasLimit,
            gasPrice,
            nonce,
            chainId: 8453
          },
          pk
        );

      const tx =
        await web3.eth.sendSignedTransaction(
          signed.rawTransaction
        );

      console.log(
        "MINT OK TX =",
        tx.transactionHash
      );

      return res.json({
        ok: true,
        action: "mint_from_balance",
        tx: tx.transactionHash,
        original_id,
        user_address,
        backend_address:
          account.address,
        mint_fee_wei:
          mintFeeWei
      });
    }

    /* ============================================
       ACTION: copy_withdraw
       VÝBER PRIAMO Z KONTRAKTU
    ============================================ */

    if (action === "copy_withdraw") {

      if (
        !user_address ||
        !withdraw_to ||
        !amount_eth
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Missing user_address, withdraw_to or amount_eth"
        });
      }

      if (
        !web3.utils.isAddress(
          withdraw_to
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid withdraw_to"
        });
      }

      const amountEth =
        String(amount_eth)
          .replace(",", ".")
          .trim();

      const amountWei =
        web3.utils.toWei(
          amountEth,
          "ether"
        );

      if (
        BigInt(amountWei) <= 0n
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Invalid withdraw amount"
        });
      }

      console.log(
        "BACKEND WITHDRAW START"
      );

      const txCall =
        contract.methods
          .backendWithdraw(
            withdraw_to,
            amountWei
          );

      const gas =
        await txCall
          .estimateGas({
            from: account.address
          });

      const gasPrice =
        await web3.eth.getGasPrice();

      const gasLimit =
        Math.ceil(
          Number(gas) * 1.25
        );

      const nonce =
        await web3.eth.getTransactionCount(
          account.address,
          "pending"
        );

      const signed =
        await web3.eth.accounts.signTransaction(
          {
            from: account.address,
            to: contractAddress,
            data: txCall.encodeABI(),
            gas: gasLimit,
            gasPrice,
            nonce,
            chainId: 8453
          },
          pk
        );

      const tx =
        await web3.eth.sendSignedTransaction(
          signed.rawTransaction
        );

      console.log(
        "WITHDRAW OK TX =",
        tx.transactionHash
      );

      return res.json({
        ok: true,
        action: "copy_withdraw",
        tx: tx.transactionHash,
        user_address,
        withdraw_to,
        amount_eth: amountEth,
        amount_wei: amountWei
      });
    }

    /* ============================================
       INVALID ACTION
    ============================================ */

    return res.status(400).json({
      ok: false,
      error: "Invalid action"
    });

  } catch (e) {

    console.error(
      "COPYMINT API ERROR =",
      e
    );

    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}