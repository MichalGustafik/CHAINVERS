// /api/mintchain.js
console.log("=== BOOT: CHAINVERS /api/mintchain ===");

import Web3 from "web3";

export const maxDuration = 60;

function log(msg, data = null) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line, data || "");
}

function parseErr(e) {
  return (
    e?.data?.message ||
    e?.reason ||
    e?.message ||
    "Unknown error"
  );
}

function loadAbi() {
  const raw =
    process.env.CONTRACT_ABI ||
    process.env.ABI ||
    process.env.CONTRACT_ABI_JSON;

  if (!raw) throw new Error("Missing CONTRACT_ABI env");

  return JSON.parse(raw);
}

function extractTokenIdFromReceipt(web3, receipt, contractAddress) {
  const transferTopic = web3.utils.sha3("Transfer(address,address,uint256)");
  const zeroTopic = "0x" + "0".repeat(64);

  const logs = receipt?.logs || [];

  for (const l of logs) {
    const sameContract =
      String(l.address || "").toLowerCase() === String(contractAddress || "").toLowerCase();

    if (!sameContract) continue;
    if (!l.topics || l.topics[0] !== transferTopic) continue;

    const fromTopic = l.topics[1];

    if (String(fromTopic).toLowerCase() !== zeroTopic.toLowerCase()) continue;

    const tokenTopic = l.topics[3];

    if (!tokenTopic) continue;

    return web3.utils.hexToNumberString(tokenTopic);
  }

  return null;
}

export default async function handler(req, res) {
  const logs = [];

  try {
    log("REQUEST_START", { method: req.method });

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        success: false,
        error: "Method not allowed"
      });
    }

    const {
      metadataURI,
      crop_id,
      walletAddress,
      wallet
    } = req.body || {};

    const toWallet = walletAddress || wallet;

    log("BODY", {
      metadataURI,
      crop_id,
      walletAddress: toWallet
    });

    if (!metadataURI || !crop_id || !toWallet) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "Missing metadataURI, crop_id or walletAddress"
      });
    }

    const rpc = process.env.PROVIDER_URL;
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;

    if (!rpc) throw new Error("Missing PROVIDER_URL");
    if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");
    if (!privateKey) throw new Error("Missing PRIVATE_KEY");

    const web3 = new Web3(rpc);
    const abi = loadAbi();

    const account = web3.eth.accounts.privateKeyToAccount(
      privateKey.startsWith("0x") ? privateKey : "0x" + privateKey
    );

    web3.eth.accounts.wallet.add(account);

    const contract = new web3.eth.Contract(abi, contractAddress);

    log("OWNER_WALLET", account.address);

    let mintFee = "0";

    try {
      mintFee = await contract.methods.mintFee().call();
    } catch (e) {
      log("MINT_FEE_READ_FAIL", parseErr(e));
    }

    log("MINT_FEE", {
      wei: mintFee,
      eth: web3.utils.fromWei(mintFee, "ether")
    });

    let method;

    if (contract.methods.createOriginal) {
      method = contract.methods.createOriginal(
        metadataURI,
        metadataURI,
        500,
        1000
      );
    } else if (contract.methods.mintOriginal) {
      method = contract.methods.mintOriginal(
        toWallet,
        metadataURI
      );
    } else if (contract.methods.mintNFT) {
      method = contract.methods.mintNFT(
        toWallet,
        metadataURI
      );
    } else {
      throw new Error("ABI neobsahuje createOriginal/mintOriginal/mintNFT");
    }

    const gas = await method.estimateGas({
      from: account.address,
      value: mintFee
    });

    const gasPrice = await web3.eth.getGasPrice();

    log("GAS", {
      gas: gas.toString(),
      gasPrice: gasPrice.toString()
    });

    const tx = {
      from: account.address,
      to: contractAddress,
      data: method.encodeABI(),
      gas: Math.ceil(Number(gas) * 1.25),
      gasPrice,
      value: mintFee
    };

    const signed = await web3.eth.accounts.signTransaction(
      tx,
      account.privateKey
    );

    const receipt = await web3.eth.sendSignedTransaction(
      signed.rawTransaction
    );

    const tokenId = extractTokenIdFromReceipt(web3, receipt, contractAddress);

    log("MINT_OK", {
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      tokenId
    });

    if (!tokenId) {
      return res.status(500).json({
        ok: false,
        success: false,
        error: "Mint OK, but tokenId was not found in Transfer event",
        txHash: receipt.transactionHash,
        contractAddress,
        cropId: crop_id,
        metadataURI
      });
    }

    return res.status(200).json({
      ok: true,
      success: true,
      message: "Mint OK",
      txHash: receipt.transactionHash,
      contractAddress,
      tokenId,
      token_id: tokenId,
      cropId: crop_id,
      crop_id,
      metadataURI,
      openseaUrl: `https://opensea.io/assets/base/${contractAddress}/${tokenId}`
    });

  } catch (e) {
    log("HANDLER_FATAL", parseErr(e));

    return res.status(500).json({
      ok: false,
      success: false,
      error: parseErr(e),
      stack: e?.stack || null
    });
  }
}