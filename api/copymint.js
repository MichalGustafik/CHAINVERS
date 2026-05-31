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

export default async function handler(req, res) {

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
      user_address
    } = req.body || {};

    if (!original_id || !user_address) {
      return res.status(400).json({
        ok: false,
        error: "Missing original_id or user_address"
      });
    }

    const rpc =
      process.env.PROVIDER_URL;

    const pk =
      process.env.PRIVATE_KEY;

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    if (!rpc) {
      return res.status(500).json({
        ok: false,
        error: "Missing PROVIDER_URL"
      });
    }

    if (!pk) {
      return res.status(500).json({
        ok: false,
        error: "Missing PRIVATE_KEY"
      });
    }

    if (!contractAddress) {
      return res.status(500).json({
        ok: false,
        error: "Missing CONTRACT_ADDRESS"
      });
    }

    const web3 =
      new Web3(rpc);

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    let mintFeeWei =
      "0";

    try {

      mintFeeWei =
        await contract.methods
          .mintFee()
          .call();

    } catch (e) {

      mintFeeWei =
        web3.utils.toWei(
          "0.0002",
          "ether"
        );
    }

    if (action === "wallet_prepare") {

      return res.json({
        ok: true,
        action: "wallet_prepare",
        contract_address: contractAddress,
        original_id,
        user_address,
        mint_fee_wei: mintFeeWei
      });
    }

    if (action !== "mint_from_balance") {
      return res.status(400).json({
        ok: false,
        error: "Invalid action"
      });
    }

    const account =
      web3.eth.accounts.privateKeyToAccount(pk);

    web3.eth.accounts.wallet.add(account);

    const gas =
      await contract.methods
        .mintCopy(original_id)
        .estimateGas({
          from: account.address,
          value: mintFeeWei
        });

    const gasLimit =
      Math.ceil(Number(gas) * 1.25);

    const tx =
      await contract.methods
        .mintCopy(original_id)
        .send({
          from: account.address,
          gas: gasLimit,
          value: mintFeeWei
        });

    return res.json({
      ok: true,
      action: "mint_from_balance",
      tx: tx.transactionHash,
      original_id,
      user_address,
      contract_address: contractAddress,
      mint_fee_wei: mintFeeWei
    });

  } catch (e) {

    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}