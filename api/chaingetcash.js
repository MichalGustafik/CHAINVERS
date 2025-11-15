import Web3 from "web3";
import fetch from "node-fetch";

/* ============================================================
   ENV
============================================================ */
const PRIMARY_RPC   = process.env.PROVIDER_URL;
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

/* ============================================================
   AUTO RPC
============================================================ */
async function initWeb3() {
  const RPCs = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of RPCs) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("✅ Using RPC:", rpc);
      return w3;
    } catch (e) {
      console.log("⚠️ RPC failed", rpc, e.message);
    }
  }
  throw new Error("No RPC available");
}

const web3 = await initWeb3();

/* ============================================================
   ABI
============================================================ */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
  },
  {
    type: "function",
    name: "mintFee",
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
];

/* ============================================================
   LOGGING → InfinityFree
============================================================ */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`,
      }),
    });
  } catch {}
}

const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* ============================================================
   HELPERS
============================================================ */

async function getBalance(addr) {
  try {
    const wei = await web3.eth.getBalance(addr);
    return Number(web3.utils.fromWei(wei, "ether"));
  } catch (e) {
    await log("⚠️ getBalance error:", e.message);
    return 0;
  }
}

async function getGasPrice() {
  try {
    const g = await web3.eth.getGasPrice();
    await log("⛽ Gas:", web3.utils.fromWei(g, "gwei"), "GWEI");
    return g;
  } catch (e) {
    await log("⚠️ gas fail:", e.message);
    return web3.utils.toWei("1", "gwei");
  }
}

async function getMintFee(contract) {
  try {
    const feeWei = await contract.methods.mintFee().call();
    const feeEth = Number(web3.utils.fromWei(feeWei, "ether"));
    await log("💰 Contract mintFee =", feeEth, "ETH");
    return feeEth;
  } catch (e) {
    await log("⚠️ mintFee() error:", e.message);
    return 0.001;
  }
}

/* ============================================================
   UPDATE ORDER
============================================================ */
async function updateOrderBack(data) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await log("📝 update_order sent:", JSON.stringify(data));
  } catch (e) {
    await log("⚠️ update_order fail:", e.message);
  }
}

/* ============================================================
   SEND TX → mintCopy()
============================================================ */
async function doMint(token_id, ethAmount) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(ethAmount), "ether");
  const gasPrice = await getGasPrice();

  const gasLimit = await contract.methods
    .mintCopy(token_id)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    chainId: await web3.eth.getChainId(),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  await log("✅ TX:", receipt.transactionHash);

  return receipt.transactionHash;
}

/* ============================================================
   HANDLER
============================================================ */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    await log("===== CHAINGETCASH START =====");

    const orders = req.body?.orders || [];
    const bal    = await getBalance(FROM);
    await log("💠 Balance", FROM, ":", bal, "ETH");

    // uloženie zostatku do InfinityFree
    try {
      await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${bal}`);
    } catch {}

    if (!orders.length) {
      await log("ℹ️ No orders");
      return res.json({ ok: true, funded: 0 });
    }

    const contract   = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    let funded = 0;

    for (const o of orders) {
      const token_id   = Number(o.token_id);
      const payment_id = o.payment_id || "";
      const user_addr  = o.user_address;

      if (!token_id) {
        await log("⚠️ Missing token_id", JSON.stringify(o));
        continue;
      }

      const eur = Number(o.amount_eur ?? o.amount ?? 0);

      // cena mintu
      let eth = eur > 0 ? eur / 3000 : mintFeeEth;
      if (eth < mintFeeEth) eth = mintFeeEth;

      await log(`→ Token ${token_id}: ${eur.toFixed(2)}€ (${eth} ETH)`);

      try {
        const tx = await doMint(token_id, eth);
        funded++;

        // pošleme JSON späť do InfinityFree
        await updateOrderBack({
          order_id    : String(token_id),   // TOTO JE HLAVNÉ ID
          payment_id  : payment_id,
          token_id    : token_id,
          user_addr   : user_addr,
          tx_hash     : tx
        });

      } catch (err) {
        await log(`⚠️ MintCopy ${token_id} failed: ${err.message}`);
      }
    }

    await log("📊 Done | funded =", funded);
    res.json({ ok: true, funded });

  } catch (e) {
    await log("❌ ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}