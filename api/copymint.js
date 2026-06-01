// ============================================
// FILE: /api/copymint.js
// ============================================

import Web3 from "web3";

export const maxDuration = 60;

const ABI = [
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
  }
];

function cleanPrivateKey(pk) {
  if (!pk) return "";
  pk = String(pk).trim();
  return pk.startsWith("0x") ? pk : "0x" + pk;
}

function cleanAddress(addr) {
  return String(addr || "").trim();
}

function isValidUint(v) {
  return /^\d+$/.test(String(v || "").trim());
}

export default async function handler(req, res) {
  const logs = [];

  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logs.push(line);
    console.log(line);
  }

  try {
    log("===== NEW COPYMINT API CALL =====");

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed",
        logs
      });
    }

    const {
      action,
      original_id,
      user_address
    } = req.body || {};

    log("BODY => " + JSON.stringify(req.body || {}));

    if (!original_id || !user_address) {
      return res.status(400).json({
        ok: false,
        error: "Missing original_id or user_address",
        logs
      });
    }

    if (!isValidUint(original_id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid original_id",
        logs
      });
    }

    const rpc =
      process.env.PROVIDER_URL ||
      "https://mainnet.base.org";

    const pk =
      cleanPrivateKey(process.env.PRIVATE_KEY);

    const contractAddress =
      cleanAddress(process.env.CONTRACT_ADDRESS);

    if (!rpc) {
      return res.status(500).json({
        ok: false,
        error: "Missing PROVIDER_URL",
        logs
      });
    }

    if (!pk) {
      return res.status(500).json({
        ok: false,
        error: "Missing PRIVATE_KEY",
        logs
      });
    }

    if (!contractAddress) {
      return res.status(500).json({
        ok: false,
        error: "Missing CONTRACT_ADDRESS",
        logs
      });
    }

    const web3 = new Web3(rpc);

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    const account =
      web3.eth.accounts.privateKeyToAccount(pk);

    const fromAddress =
      account.address;

    log("FROM => " + fromAddress);
    log("CONTRACT => " + contractAddress);
    log("ORIGINAL ID => " + original_id);

    let chainId = 8453;

    try {
      chainId = await web3.eth.getChainId();
      log("CHAIN ID => " + chainId);
    } catch (e) {
      log("CHAIN ID READ FAILED => " + e.message);
    }

    let mintFeeWei = "0";

    try {
      mintFeeWei =
        await contract.methods
          .mintFee()
          .call();

      log("MINT FEE WEI => " + mintFeeWei);
    } catch (e) {
      mintFeeWei =
        web3.utils.toWei(
          "0.0002",
          "ether"
        );

      log("MINT FEE FALLBACK WEI => " + mintFeeWei);
    }

    if (action === "wallet_prepare") {
      return res.json({
        ok: true,
        action: "wallet_prepare",
        contract_address: contractAddress,
        original_id: String(original_id),
        user_address,
        mint_fee_wei: mintFeeWei,
        logs
      });
    }

    if (action !== "mint_from_balance") {
      return res.status(400).json({
        ok: false,
        error: "Invalid action",
        logs
      });
    }

    if (!mintFeeWei || BigInt(mintFeeWei) <= 0n) {
      return res.status(400).json({
        ok: false,
        error: "Invalid mint fee",
        mint_fee_wei: mintFeeWei,
        logs
      });
    }

    let fromBalanceWei = "0";

    try {
      fromBalanceWei =
        await web3.eth.getBalance(fromAddress);

      log("FROM BALANCE WEI => " + fromBalanceWei);
    } catch (e) {
      log("BALANCE READ FAILED => " + e.message);
    }

    const txCall =
      contract.methods.mintCopy(
        String(original_id)
      );

    let gas = 0;

    try {
      gas =
        await txCall.estimateGas({
          from: fromAddress,
          value: mintFeeWei
        });

      log("ESTIMATED GAS => " + gas);
    } catch (e) {
      log("GAS ESTIMATE FAILED => " + e.message);

      return res.status(500).json({
        ok: false,
        error: "Gas estimate failed: " + e.message,
        logs
      });
    }

    const gasLimit =
      Math.ceil(Number(gas) * 1.3);

    let gasPrice =
      await web3.eth.getGasPrice();

    log("GAS LIMIT => " + gasLimit);
    log("GAS PRICE => " + gasPrice);

    const nonce =
      await web3.eth.getTransactionCount(
        fromAddress,
        "pending"
      );

    log("NONCE => " + nonce);

    const txData =
      txCall.encodeABI();

    const txObject = {
      from: fromAddress,
      to: contractAddress,
      data: txData,
      value: mintFeeWei,
      gas: gasLimit,
      gasPrice: gasPrice,
      nonce: nonce,
      chainId: Number(chainId)
    };

    log("SIGNING TX");

    const signed =
      await web3.eth.accounts.signTransaction(
        txObject,
        pk
      );

    if (!signed.rawTransaction) {
      return res.status(500).json({
        ok: false,
        error: "Signing failed",
        logs
      });
    }

    log("SENDING TX");

    const receipt =
      await web3.eth.sendSignedTransaction(
        signed.rawTransaction
      );

    log("COPYMINT OK => " + receipt.transactionHash);

    return res.json({
      ok: true,
      action: "mint_from_balance",
      tx: receipt.transactionHash,
      original_id: String(original_id),
      user_address,
      contract_address: contractAddress,
      mint_fee_wei: mintFeeWei,
      from: fromAddress,
      logs
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      stack: e.stack || null,
      logs
    });
  }
}