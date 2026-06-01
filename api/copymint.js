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
  },
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
  }
];

function cleanPrivateKey(pk) {
  if (!pk) return "";
  pk = String(pk).trim();
  return pk.startsWith("0x") ? pk : "0x" + pk;
}

function ipfsToHttp(url) {
  if (!url) return "";

  url = String(url).trim();

  if (url.startsWith("ipfs://ipfs/")) {
    return "https://gateway.pinata.cloud/ipfs/" + url.replace("ipfs://ipfs/", "");
  }

  if (url.startsWith("ipfs://")) {
    return "https://gateway.pinata.cloud/ipfs/" + url.replace("ipfs://", "");
  }

  return url;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const text = await r.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text
    };
  }
}

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

    const rpc = process.env.PROVIDER_URL;
    const pk = cleanPrivateKey(process.env.PRIVATE_KEY);
    const contractAddress = process.env.CONTRACT_ADDRESS;

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

    const web3 = new Web3(rpc);

    const contract = new web3.eth.Contract(
      ABI,
      contractAddress
    );

    // ============================================
    // ACTION: scan_preview
    // ============================================

    if (action === "scan_preview") {
      const id = token_id || original_id;

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "Missing token_id"
        });
      }

      let tokenUri = "";

      try {
        tokenUri = await contract.methods
          .tokenURI(id)
          .call();
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: "tokenURI failed: " + e.message,
          token_id: String(id)
        });
      }

      const metadataUrl = ipfsToHttp(tokenUri);
      const metadata = await fetchJson(metadataUrl);

      let image =
        metadata?.image ||
        metadata?.image_url ||
        metadata?.animation_url ||
        metadata?.properties?.image ||
        "";

      image = ipfsToHttp(image);

      return res.json({
        ok: true,
        action: "scan_preview",
        token_id: String(id),
        contract: contractAddress,
        token_uri: tokenUri,
        metadata_url: metadataUrl,
        image,
        metadata
      });
    }

    let mintFeeWei = "0";

    try {
      mintFeeWei = await contract.methods
        .mintFee()
        .call();
    } catch (e) {
      mintFeeWei = web3.utils.toWei(
        "0.0002",
        "ether"
      );
    }

    // ============================================
    // ACTION: wallet_prepare
    // ============================================

    if (action === "wallet_prepare") {
      if (!original_id || !user_address) {
        return res.status(400).json({
          ok: false,
          error: "Missing original_id or user_address"
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

    if (!pk) {
      return res.status(500).json({
        ok: false,
        error: "Missing PRIVATE_KEY"
      });
    }

    const account = web3.eth.accounts.privateKeyToAccount(pk);

    // ============================================
    // ACTION: mint_from_balance
    // ============================================

    if (action === "mint_from_balance") {
      if (!original_id || !user_address) {
        return res.status(400).json({
          ok: false,
          error: "Missing original_id or user_address"
        });
      }

      const txCall = contract.methods.mintCopy(original_id);

      const gas = await txCall.estimateGas({
        from: account.address,
        value: mintFeeWei
      });

      const gasLimit = Math.ceil(Number(gas) * 1.25);
      const gasPrice = await web3.eth.getGasPrice();

      const nonce = await web3.eth.getTransactionCount(
        account.address,
        "pending"
      );

      const signed = await web3.eth.accounts.signTransaction(
        {
          from: account.address,
          to: contractAddress,
          data: txCall.encodeABI(),
          value: mintFeeWei,
          gas: gasLimit,
          gasPrice: gasPrice,
          nonce: nonce,
          chainId: 8453
        },
        pk
      );

      const tx = await web3.eth.sendSignedTransaction(
        signed.rawTransaction
      );

      return res.json({
        ok: true,
        action: "mint_from_balance",
        tx: tx.transactionHash,
        original_id,
        user_address,
        contract_address: contractAddress,
        mint_fee_wei: mintFeeWei
      });
    }

    // ============================================
    // ACTION: copy_withdraw
    // ============================================

    if (action === "copy_withdraw") {
      if (!user_address || !withdraw_to || !amount_eth) {
        return res.status(400).json({
          ok: false,
          error: "Missing user_address, withdraw_to or amount_eth"
        });
      }

      if (!web3.utils.isAddress(withdraw_to)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid withdraw_to address"
        });
      }

      const amountEth = String(amount_eth)
        .replace(",", ".")
        .trim();

      const amountWei = web3.utils.toWei(
        amountEth,
        "ether"
      );

      if (BigInt(amountWei) <= 0n) {
        return res.status(400).json({
          ok: false,
          error: "Invalid withdraw amount"
        });
      }

      const balanceWei = await web3.eth.getBalance(
        account.address
      );

      const gasPrice = await web3.eth.getGasPrice();
      const gasCostWei = BigInt(gasPrice) * 21000n;
      const totalNeededWei = BigInt(amountWei) + gasCostWei;

      if (BigInt(balanceWei) < totalNeededWei) {
        return res.status(400).json({
          ok: false,
          error: "Backend wallet has insufficient balance",
          backend_balance_wei: balanceWei,
          amount_wei: amountWei,
          gas_cost_wei: gasCostWei.toString(),
          total_needed_wei: totalNeededWei.toString()
        });
      }

      const nonce = await web3.eth.getTransactionCount(
        account.address,
        "pending"
      );

      const signed = await web3.eth.accounts.signTransaction(
        {
          from: account.address,
          to: withdraw_to,
          value: amountWei,
          gas: 21000,
          gasPrice: gasPrice,
          nonce: nonce,
          chainId: 8453
        },
        pk
      );

      const tx = await web3.eth.sendSignedTransaction(
        signed.rawTransaction
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

    return res.status(400).json({
      ok: false,
      error: "Invalid action"
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      stack: e.stack
    });
  }
}