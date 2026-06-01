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

export default async function handler(req, res) {

  const logs = [];

  function log(msg){
    const line = `[${new Date().toISOString()}] ${msg}`;
    logs.push(line);
    console.log(line);
  }

  try {

    log("===== COPYMINT API =====");

    if (req.method !== "POST") {
      return res.status(405).json({
        ok:false,
        error:"Method not allowed",
        logs
      });
    }

    const body = req.body || {};

    log("BODY => " + JSON.stringify(body));

    const action =
      String(body.action || "").trim();

    const rpc =
      process.env.PROVIDER_URL ||
      "https://mainnet.base.org";

    const pk =
      cleanPrivateKey(process.env.PRIVATE_KEY);

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    if (!rpc || !pk || !contractAddress) {
      return res.status(500).json({
        ok:false,
        error:"Missing ENV",
        logs
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

    const fromAddress =
      account.address;

    /* ============================================
       READ MINT FEE
    ============================================ */

    let mintFeeWei = "0";

    try {

      mintFeeWei =
        await contract.methods
          .mintFee()
          .call();

    } catch(e){

      mintFeeWei =
        web3.utils.toWei(
          "0.0002",
          "ether"
        );
    }

    /* ============================================
       WALLET PREPARE
    ============================================ */

    if (action === "wallet_prepare") {

      return res.json({
        ok:true,
        action,
        contract_address:contractAddress,
        mint_fee_wei:mintFeeWei,
        logs
      });
    }

    /* ============================================
       MINT FROM BALANCE
    ============================================ */

    if (action === "mint_from_balance") {

      const originalId =
        String(
          body.original_id || ""
        ).trim();

      if (!/^\d+$/.test(originalId)) {
        return res.status(400).json({
          ok:false,
          error:"Invalid original_id",
          logs
        });
      }

      log("MINT ORIGINAL => " + originalId);

      const txCall =
        contract.methods.mintCopy(originalId);

      const gas =
        await txCall.estimateGas({
          from:fromAddress,
          value:mintFeeWei
        });

      const gasPrice =
        await web3.eth.getGasPrice();

      const nonce =
        await web3.eth.getTransactionCount(
          fromAddress,
          "pending"
        );

      const txObject = {
        from:fromAddress,
        to:contractAddress,
        data:txCall.encodeABI(),
        value:mintFeeWei,
        gas:Math.ceil(Number(gas) * 1.3),
        gasPrice,
        nonce,
        chainId:8453
      };

      log("SIGN TX");

      const signed =
        await web3.eth.accounts
          .signTransaction(
            txObject,
            pk
          );

      log("SEND TX");

      const receipt =
        await web3.eth
          .sendSignedTransaction(
            signed.rawTransaction
          );

      log("COPYMINT OK => " + receipt.transactionHash);

      return res.json({
        ok:true,
        action,
        tx:receipt.transactionHash,
        mint_fee_wei:mintFeeWei,
        logs
      });
    }

    /* ============================================
       COPY WITHDRAW
    ============================================ */

    if (action === "copy_withdraw") {

      const withdrawTo =
        String(
          body.withdraw_to || ""
        ).trim();

      const amountEth =
        String(
          body.amount_eth || "0"
        ).replace(",", ".");

      if (
        !web3.utils.isAddress(withdrawTo)
      ) {
        return res.status(400).json({
          ok:false,
          error:"Invalid withdraw address",
          logs
        });
      }

      const amountWei =
        web3.utils.toWei(
          amountEth,
          "ether"
        );

      if (
        BigInt(amountWei) <= 0n
      ) {
        return res.status(400).json({
          ok:false,
          error:"Invalid withdraw amount",
          logs
        });
      }

      log("WITHDRAW TO => " + withdrawTo);
      log("AMOUNT ETH => " + amountEth);

      const gasPrice =
        await web3.eth.getGasPrice();

      const nonce =
        await web3.eth.getTransactionCount(
          fromAddress,
          "pending"
        );

      const txObject = {
        from:fromAddress,
        to:withdrawTo,
        value:amountWei,
        gas:21000,
        gasPrice,
        nonce,
        chainId:8453
      };

      log("SIGN WITHDRAW TX");

      const signed =
        await web3.eth.accounts
          .signTransaction(
            txObject,
            pk
          );

      log("SEND WITHDRAW TX");

      const receipt =
        await web3.eth
          .sendSignedTransaction(
            signed.rawTransaction
          );

      log("WITHDRAW OK => " + receipt.transactionHash);

      return res.json({
        ok:true,
        action,
        tx:receipt.transactionHash,
        amount_eth:amountEth,
        logs
      });
    }

    return res.status(400).json({
      ok:false,
      error:"Invalid action",
      logs
    });

  } catch(e){

    return res.status(500).json({
      ok:false,
      error:e.message || String(e),
      stack:e.stack || null,
      logs
    });
  }
}