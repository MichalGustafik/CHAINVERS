import Web3 from "web3";
import fetch from "node-fetch";

/* ======================= ENV ======================= */
const RPCs = [
  process.env.PROVIDER_URL,
  "https://mainnet.base.org",
  "https://base.llamarpc.com"
];

const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = process.env.INF_FREE_URL;

const MIN_FREE_MINT_VALUE = 0.001;     // fixed confirmed minimum
const REQUIRED_RESERVE     = 0.0005;   // BALANCE that MUST stay in wallet

/* ======================= INIT RPC ======================= */
async function getWeb3() {
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✓ Using RPC:", rpc);
      return w3;
    } catch {}
  }
  throw new Error("No RPC available");
}
const web3 = await getWeb3();

/* ======================= ABI ======================= */
const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

/* ======================= LOG ======================= */
async function log(msg) {
  console.log(msg);
  if (!INF_FREE_URL) return;
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`
      })
    });
  } catch {}
}

/* ======================= HELPER ======================= */
async function getGas() {
  const g = await web3.eth.getGasPrice();
  await log(`⛽ Gas: ${web3.utils.fromWei(g, "gwei")} GWEI`);
  return g;
}

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
    await log("⚠️ CoinGecko failed → 2500 fallback");
    return 2500;
  }
}

async function getBalance() {
  const wei = await web3.eth.getBalance(FROM);
  const eth = Number(web3.utils.fromWei(wei, "ether"));
  return eth;
}

/* ============= SEND MINT ============== */
async function mint(user, token, amountEth) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const gasPrice = await getGas();

  let valueEth = amountEth;

  /* FREE MINT MODE */
  if (amountEth <= 0) {
    valueEth = MIN_FREE_MINT_VALUE;
    await log(`🟪 FREE-MINT mode → sending ${valueEth} ETH`);
  }

  const valueWei = web3.utils.toWei(valueEth.toString(), "ether");

  const gasLimit = await contract.methods
    .fundTokenFor(user, token)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.fundTokenFor(user, token).encodeABI(),
    gas: gasLimit,
    gasPrice,
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  await log(`🔥 MINT OK → tx: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* ============= UPDATE IF ============== */
async function updateIF(paymentId, txHash) {
  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        order_id: paymentId,
        tx_hash: txHash
      })
    });

    await log("↩ IF status: " + (await r.text()));
  } catch (e) {
    await log("❌ update_order error: " + e.message);
  }
}

/* ======================= MAIN ======================= */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const action = req.body.action;
    if (!action) return res.status(400).json({ ok: false, error: "Missing action" });

    /* BALANCE CHECK */
    if (action === "balance") {
      const bal = await getBalance();
      await log(`💠 Balance=${bal}`);
      return res.json({ ok: true, balance_eth: bal });
    }

    /* SINGLE MINT */
    if (action === "mint") {
      const { payment_id, user_address, token_id, amount_eur } = req.body;

      await log(`🔥 MINT request: ${payment_id} token=${token_id}`);

      const bal = await getBalance();
      if (bal < REQUIRED_RESERVE) {
        await log(`❌ ERROR: Low balance (${bal}). Need reserve: ${REQUIRED_RESERVE}`);
        return res.status(400).json({
          ok: false,
          error: "Insufficient balance. Please top up first."
        });
      }

      const rate = await getRate();
      const eth = amount_eur > 0 ? amount_eur / rate : 0;

      const txHash = await mint(user_address, token_id, eth);
      await updateIF(payment_id, txHash);

      return res.json({ ok: true, tx_hash: txHash });
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });

  } catch (e) {
    await log("❌ ERROR: " + e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}