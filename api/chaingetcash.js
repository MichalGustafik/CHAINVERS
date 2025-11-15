import Web3 from "web3";
import fetch from "node-fetch";

/* === ENV === */
const PRIMARY_RPC   = process.env.PROVIDER_URL || "https://base-mainnet.infura.io/v3/YOUR_KEY";
const SECONDARY_RPC = "https://mainnet.base.org";
const TERTIARY_RPC  = "https://base.llamarpc.com";

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const FROM          = process.env.FROM_ADDRESS;
const CONTRACT      = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL  = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/,"");

/* === RPC AUTO-SELECTION === */
async function initWeb3() {
  const rpcCandidates = [PRIMARY_RPC, SECONDARY_RPC, TERTIARY_RPC];
  for (const rpc of rpcCandidates) {
    try {
      const w3 = new Web3(rpc);
      await w3.eth.getBlockNumber();
      console.log(`✅ Using RPC: ${rpc}`);
      return w3;
    } catch (e) {
      console.log(`⚠️ RPC failed ${rpc}: ${e.message}`);
    }
  }
  throw new Error("No available RPC nodes");
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
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
];

/* === API === */
export const config = { api: { bodyParser: true } };

/* === LOGGING DO IF === */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "ChainversBot/1.0",
      },
      body: new URLSearchParams({
        message: `[${new Date().toISOString()}] ${msg}`,
      }),
    });
  } catch (e) {
    console.log("log transfer fail:", e.message);
  }
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* === HELPERS === */
async function getEurEthRate() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
    );
    const j = await r.json();
    const rate = j?.ethereum?.eur;
    await log(`💱 1 ETH = ${rate} EUR`);
    return rate || 2500;
  } catch {
    await log("⚠️ CoinGecko fail → 2500");
    return 2500;
  }
}

async function getGasPrice() {
  try {
    const gp = await web3.eth.getGasPrice();
    await log(`⛽ Gas: ${web3.utils.fromWei(gp, "gwei")} GWEI`);
    return gp;
  } catch (e) {
    await log(`⚠️ GasPrice error: ${e.message}`);
    return web3.utils.toWei("1", "gwei");
  }
}

async function getBalanceEth(addr) {
  try {
    const w = await web3.eth.getBalance(addr);
    const v = Number(web3.utils.fromWei(w, "ether"));
    return v;
  } catch (e) {
    await log(`⚠️ getBalance fail: ${e.message}`);
    return 0;
  }
}

/* === mintFee autodetekcia z kontraktu === */
async function getMintFee(contract) {
  try {
    const feeWei = await contract.methods.mintFee().call();
    const feeEth = Number(web3.utils.fromWei(feeWei, "ether"));
    await log(`💰 Contract mintFee = ${feeEth} ETH`);
    return feeEth;
  } catch (e) {
    await log(`⚠️ mintFee() error: ${e.message}`);
    return 0.001; // fallback minimálny fee
  }
}

/* === UPDATE ORDER V IF === */
async function markOrderPaid(order, txHash) {
  const body = {
    order_id:   order.payment_id || String(order.token_id),
    payment_id: order.payment_id || "",
    token_id:   order.token_id,
    user_addr:  order.user_address,
    tx_hash:    txHash,
  };

  try {
    const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    await log(`📝 update_order resp: ${txt}`);
  } catch (e) {
    await log(`⚠️ update_order fail: ${e.message}`);
  }
}

/* === mintCopy transakcia === */
async function mintCopyTx({ token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(ethAmount), "ether");

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
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId(),
  };

  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

/* === Hlavný handler === */
export default async function handler(req, res) {
  try {
    /* ====== GET ?action=balance → len zistí ETH a pošle do IF + vráti JSON ====== */
    if (req.method === "GET" && req.query?.action === "balance") {
      await log("===== CHAINGETCASH BALANCE CHECK =====");
      const balEth = (await getBalanceEth(FROM)).toFixed(6);
      await log(`💠 Balance ${FROM}: ${balEth} ETH`);

      try {
        await fetch(
          `${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(
            balEth
          )}`
        );
      } catch {}

      return res.status(200).json({ ok: true, balance: balEth });
    }

    /* ====== POST – mintovanie / dobíjanie objednávok ====== */
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    await log("===== CHAINGETCASH START =====");

    // 1) zostatok
    const balEthNum = await getBalanceEth(FROM);
    const balEth = balEthNum.toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);

    // push do IF (aby accptpay hneď videl číslo)
    try {
      await fetch(
        `${INF_FREE_URL}/accptpay.php?action=balance&val=${encodeURIComponent(
          balEth
        )}`
      );
    } catch {}

    const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
    if (!orders.length) {
      await log("ℹ️ Žiadne objednávky v tele – len balance update");
      return res.status(200).json({
        ok: true,
        balance_eth: balEth,
        funded_count: 0,
      });
    }

    // 2) kurz + gas + kontrakt
    const [rate, gasPrice] = await Promise.all([
      getEurEthRate(),
      getGasPrice(),
    ]);
    const contract = new web3.eth.Contract(ABI, CONTRACT);
    const mintFeeEth = await getMintFee(contract);

    // 3) výpočet nákladov len informačne
    let sumEur = 0;
    orders.forEach((o) => {
      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      if (eur > 0) sumEur += eur;
    });
    await log(`📊 Náklady: Objednávky=${sumEur.toFixed(2)}€`);

    // 4) samotné mintovanie
    let funded = 0;
    let remaining = balEthNum;

    for (const o of orders) {
      const tokenId = Number(o.token_id);
      if (!tokenId) {
        await log(`⚠️ Neplatný token_id v order: ${JSON.stringify(o)}`);
        continue;
      }

      const eur = Number(o.amount_eur ?? o.amount ?? 0);
      let ethAmount;
      if (eur > 0) {
        ethAmount = eur / rate;
      } else {
        // objednávka 0 → iba minimálny poplatok
        ethAmount = mintFeeEth > 0 ? mintFeeEth : 0.001;
      }

      await log(
        `→ Token ${tokenId}: ${eur.toFixed(2)}€ (${ethAmount.toFixed(
          6
        )} ETH)`
      );

      // jednoduchá kontrola zostatku (bez presného gas odhadu)
      const approxNeeded = ethAmount + 0.000001;
      if (remaining < approxNeeded) {
        await log(
          `⚠️ Skip token ${tokenId}: nedostatok ETH (have=${remaining}, need≈${approxNeeded})`
        );
        continue;
      }

      try {
        const txHash = await mintCopyTx({
          token_id: tokenId,
          ethAmount,
          gasPrice,
        });
        funded++;
        remaining -= approxNeeded;
        await markOrderPaid(o, txHash);
      } catch (err) {
        await log(`⚠️ MintCopy ${tokenId} failed: ${err.message}`);
      }
    }

    await log(`✅ MINT DONE funded=${funded}`);
    return res.status(200).json({
      ok: true,
      balance_eth: balEth,
      funded_count: funded,
    });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}