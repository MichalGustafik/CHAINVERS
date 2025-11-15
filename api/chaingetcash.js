import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PRIMARY_RPC   = process.env.PROVIDER_URL;
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

/* === RPC AUTODETECT === */
async function initWeb3() {
  const rpcList = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcList) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log("Using RPC:", rpc);
      return w3;
    } catch {}
  }
  throw new Error("No RPC working");
}
const web3 = await initWeb3();

/* === ABI === */
const ABI = [
  {
    type: "function",
    name: "mintCopy",
    inputs: [{ type: "uint256", name: "originalId" }],
  },
  {
    type: "function",
    name: "mintFee",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view"
  }
];

/* === LOG to IF === */
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
const log = async (...a) => sendLog(a.join(" "));

/* === HELPERS === */
async function getBalanceEth(addr) {
  const balWei = await web3.eth.getBalance(addr);
  return Number(web3.utils.fromWei(balWei, "ether"));
}

async function getGasPrice() {
  return await web3.eth.getGasPrice();
}

async function getEurEth() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
    const j = await r.json();
    return j.ethereum.eur;
  } catch {
    return 2500;
  }
}

async function mintCopyTx(tokenId, ethAmount) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);

  const valueWei = web3.utils.toWei(String(ethAmount), "ether");
  const gasLimit = await contract.methods
    .mintCopy(tokenId)
    .estimateGas({ from: FROM, value: valueWei });

  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.mintCopy(tokenId).encodeABI(),
    gas: gasLimit,
    gasPrice: await getGasPrice(),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId(),
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  return receipt.transactionHash;
}

/* === MAIN HANDLER === */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false });

    await log("===== CHAINGETCASH START =====");

    const orders = req.body.orders || [];
    if (!orders.length) {
      return res.json({ ok: true, funded_count: 0 });
    }

    const rate = await getEurEth();
    const funded = [];

    for (const o of orders) {
      const tokenId = Number(o.token_id);
      const eur = Number(o.amount_eur);
      const ethAmount = eur > 0 ? eur / rate : 0.001;

      let txHash = null;
      try {
        txHash = await mintCopyTx(tokenId, ethAmount);

        /* UPDATE ORDER — POSIELAME UNIVERZÁLNE ID */
        await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: o.paymentIntentId || String(tokenId),
            tx_hash: txHash,
            user_addr: o.user_address,
          }),
        });

        funded.push(tokenId);
        await log(`FINISHED ${tokenId} → ${txHash}`);
      } catch (err) {
        await log(`MintCopy ${tokenId} FAIL: ${err.message}`);
      }
    }

    return res.json({ ok: true, funded_count: funded.length });
  } catch (e) {
    await log("ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}