import Web3 from "web3";
import fetch from "node-fetch";

/* ======================= ENV ======================= */
const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

/* ======================= RPC FALLBACK ======================= */
const RPCs = [
  PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

async function initWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✓ Using RPC:", rpc);
      return w3;
    } catch {}
  }
  throw new Error("No working RPC");
}
const web3 = await initWeb3();

/* ======================= ABI FULL ======================= */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fundTokenFor",
    inputs: [
      { type: "address", name: "user" },
      { type: "uint256", name: "tokenId" }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "withdrawBalance",
    inputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [{ type: "address" }],
    stateMutability: "view"
  }
];

/* ======================= LOGGING ======================= */
async function sendLog(msg) {
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${msg}` })
    });
  } catch {}
}
const log = async (...m) => {
  console.log(...m);
  sendLog(m.join(" "));
};

/* ======================= ETH RATE ======================= */
async function getRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} €`);
    return rate || 2500;
  } catch {
    await log("⚠️ Rate fallback 2500");
    return 2500;
  }
}

/* ======================= GAS ======================= */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  await log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

/* ======================= BALANCE (WALLET) ======================= */
async function balanceEth() {
  const w = await web3.eth.getBalance(FROM);
  return Number(web3.utils.fromWei(w, "ether"));
}

/* ================================================================
   🔵 GET NFT BALANCE (ETH uložené v kontrakte)
================================================================ */
async function getNftBalance(tokenId) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const bal = await contract.methods.getBalance(tokenId).call();
  await log(`🔍 Balance NFT ${tokenId}: ${bal} WEI`);
  return bal;
}

/* ================================================================
   🔵 FUND TOKEN (ETH dobíjanie)
================================================================ */
async function fund(tokenId, user, valueWei) {

  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const tx = contract.methods.fundTokenFor(user, tokenId);
  const gasPrice = await getGas();

  const gasLimit = await tx.estimateGas({
    from: FROM,
    value: valueWei
  });

  const signed = await web3.eth.accounts.signTransaction({
    from: FROM,
    to: CONTRACT,
    gas: gasLimit,
    gasPrice,
    data: tx.encodeABI(),
    value: valueWei,
    chainId: await web3.eth.getChainId(),
    nonce: await web3.eth.getTransactionCount(FROM, "pending")
  }, PRIVATE_KEY);

  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`💰 FUND TOKEN ${tokenId} TX: ${receipt.transactionHash}`);

  return receipt.transactionHash;
}

/* ================================================================
   🔵 WITHDRAW ETH (výber z NFT)
================================================================ */
async function withdraw(tokenId, user) {

  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const owner = await contract.methods.ownerOf(tokenId).call();
  if (owner.toLowerCase() !== user.toLowerCase()) {
    throw new Error("❌ User is not NFT owner");
  }

  const tx = contract.methods.withdrawBalance(tokenId);
  const gasPrice = await getGas();
  const gasLimit = await tx.estimateGas({ from: FROM });

  const signed = await web3.eth.accounts.signTransaction({
    from: FROM,
    to: CONTRACT,
    gas: gasLimit,
    gasPrice,
    data: tx.encodeABI(),
    chainId: await web3.eth.getChainId(),
    nonce: await web3.eth.getTransactionCount(FROM, "pending")
  }, PRIVATE_KEY);

  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`🏧 WITHDRAW TOKEN ${tokenId} → ${owner} | TX=${receipt.transactionHash}`);

  return receipt.transactionHash;
}

/* ================================================================
   🔵 SEND MINT (pôvodný mintCopy)
================================================================ */
async function sendMint(token, valueEth) {

  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(valueEth.toString(), "ether");

  await log(`→ Sending valueWei = ${valueWei}`);
  const gasPrice = await getGas();

  const gasLimit = await contract.methods
    .mintCopy(token)
    .estimateGas({
      from: FROM,
      value: valueWei
    });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(token).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  await log(`🔥 Mint done TX=${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ================================================================
   🔵 UPDATE IF
================================================================ */
async function updateIF(id, tx) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: {"Content-Type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        order_id: id,
        tx_hash: tx
      })
    });
    await log("↩️ IF:", await r.text());
  } catch (e) {
    await log("❌ updateIF fail:", e.message);
  }
}

/* ================================================================
   🔵 ROUTER
================================================================ */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(400).json({ ok:false, error:"POST required" });
    }

    const action = req.body.action;

    /* === WALLET BALANCE === */
    if (action === "balance") {
      const b = await balanceEth();
      await log(`💠 Balance: ${b} ETH`);
      return res.status(200).json({ ok:true, balance_eth:b });
    }

    /* === GET NFT BALANCE === */
    if (action === "getBalance") {
      const tokenId = req.body.token_id || req.query.tokenId;
      const bal = await getNftBalance(tokenId);
      return res.status(200).json({ ok:true, tokenId, balanceWei: bal });
    }

    /* === FUND ETH TO NFT === */
    if (action === "fund") {
      const token = Number(req.body.token_id);
      const user  = req.body.user;
      const wei   = req.body.valueWei;

      const tx = await fund(token, user, wei);
      return res.json({ ok:true, token, tx });
    }

    /* === WITHDRAW ETH FROM NFT === */
    if (action === "withdraw") {
      const token = Number(req.body.token_id);
      const user  = req.body.user;

      const tx = await withdraw(token, user);
      return res.json({ ok:true, token, tx });
    }

    /* === MINT COPY === */
    if (action === "mint") {
      const paymentId = req.body.payment_id;
      const token     = Number(req.body.token_id);
      const eur       = Number(req.body.amount_eur || 0);

      await log(`🔥 MINT request: ${paymentId} token=${token}`);

      const rate = await getRate();
      let eth = eur > 0 ? eur / rate : 0;

      if (eth === 0) {
        eth = 0.001;
        await log("🟪 FREE MINT MODE → using 0.001 ETH");
      }

      const txHash = await sendMint(token, eth);

      await updateIF(paymentId, txHash);

      return res.json({
        ok: true,
        payment_id: paymentId,
        tx_hash: txHash,
        sent_eth: eth
      });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });

  } catch (e) {
    await log("❌ ERROR:", e.message);
    return res.status(500).json({ ok:false, error:e.message });
  }
}