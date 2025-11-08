import Web3 from "web3";
import fetch from "node-fetch";
import fs from "fs";

const PROVIDER_URL    = process.env.PROVIDER_URL;
const PRIVATE_KEY     = process.env.PRIVATE_KEY;
const FROM            = process.env.FROM_ADDRESS;
const CONTRACT        = process.env.CONTRACT_ADDRESS;
let   INF_FREE_URL    = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");
const BALANCE_ADDRESS = process.env.BALANCE_ADDRESS || FROM;

const web3 = new Web3(PROVIDER_URL);
const ABI = [{
  type: "function",
  name: "fundTokenFor",
  inputs: [
    { type: "address", name: "user" },
    { type: "uint256", name: "tokenId" }
  ]
}];

export const config = { api: { bodyParser: true } };

/* ============================================================
   LOG → InfinityFree (accptpay.php?action=save_log)
   ============================================================ */
async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "Mozilla/5.0 (ChainversBot)"
      },
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${msg}` }),
    });
  } catch (e) {
    console.error("⚠️ Log transfer failed:", e.message);
  }
}
const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

/* ============================================================
   HELPER FUNKCIE
   ============================================================ */
async function getEurEthRate() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur");
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
  const gp = await web3.eth.getGasPrice();
  await log(`⛽ Gas (RPC): ${web3.utils.fromWei(gp, "gwei")} GWEI`);
  return gp;
}

async function getChainBalanceEth(a) {
  const w = await web3.eth.getBalance(a);
  return Number(web3.utils.fromWei(w, "ether"));
}

/* ============================================================
   InfinityFree COOKIE bypass
   ============================================================ */
async function warmupIFCookie() {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  const r1 = await fetch(`${INF_FREE_URL}/?t=${Date.now()}`, {
    method: "GET",
    headers: { "User-Agent": ua },
  });

  const setCookie = r1.headers.get("set-cookie") || "";
  let cookie = "";

  // 1️⃣ priamo z hlavičky
  const matchHeader = /(__test=[^;]+)/i.exec(setCookie);
  if (matchHeader) cookie = matchHeader[1];

  // 2️⃣ fallback: hľadá JavaScript document.cookie="..."
  if (!cookie) {
    const html = await r1.text().catch(() => "");
    const m = html.match(/document\.cookie\s*=\s*["']([^"']*__test=[^"';]+)/i);
    if (m) cookie = m[1].split(";")[0];
  }

  // 3️⃣ fallback: meta refresh alebo URL s __test=
  if (!cookie) {
    const html = await r1.text().catch(() => "");
    const m2 = html.match(/__test=[A-Za-z0-9%]+/i);
    if (m2) cookie = decodeURIComponent(m2[0]);
  }

  // 4️⃣ ak stále nič, skúsi znova po 3s
  if (!cookie) {
    await log("⚠️ InfinityFree cookie ešte nevydal, retry za 3s");
    await new Promise(r => setTimeout(r, 3000));
    return warmupIFCookie();
  }

  await log(`🍪 Cookie získané (${cookie.slice(0, 25)}...)`);
  await fetch(`${INF_FREE_URL}/?ok=${Date.now()}`, {
    headers: { "User-Agent": ua, "Cookie": cookie },
  });

  return { ua, cookie };
}

/* ============================================================
   Načítanie objednávok z IF (refresh_safe)
   ============================================================ */
async function fetchOrdersFromIF() {
  const { ua, cookie } = await warmupIFCookie();
  const r = await fetch(`${INF_FREE_URL}/accptpay.php?action=refresh_safe&cb=${Date.now()}`, {
    headers: {
      "User-Agent": ua,
      "Cookie": cookie,
      "Referer": INF_FREE_URL + "/",
      "Accept": "text/html"
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const match = html.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (!match) throw new Error("Žiadny <pre> JSON blok");
  const arr = JSON.parse(match[1]);
  const pending = arr.filter(o => o.token_id && o.status !== "💰 Zaplatené");
  await log(`📦 Načítaných ${pending.length} čakajúcich objednávok`);
  return pending;
}

/* ============================================================
   Označenie objednávky ako zaplatenej
   ============================================================ */
async function markOrderPaid(order_id, tx_hash, user_addr) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=update_order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": INF_FREE_URL + "/",
        "User-Agent": "Mozilla/5.0 (ChainversBot)"
      },
      body: new URLSearchParams({ order_id, tx_hash, user_addr }),
    });
    await log(`📝 update_order ${order_id}`);
  } catch (e) {
    await log(`⚠️ update_order failed: ${e.message}`);
  }
}

/* ============================================================
   Odoslanie ETH do kontraktu
   ============================================================ */
async function sendEthToNFT({ user_addr, token_id, ethAmount, gasPrice }) {
  const contract = new web3.eth.Contract(ABI, CONTRACT);
  const valueWei = web3.utils.toWei(String(ethAmount), "ether");
  const gasLimit = await contract.methods.fundTokenFor(user_addr, token_id).estimateGas({ from: FROM, value: valueWei });
  const tx = {
    from: FROM,
    to: CONTRACT,
    value: valueWei,
    data: contract.methods.fundTokenFor(user_addr, token_id).encodeABI(),
    gas: web3.utils.toHex(gasLimit),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: await web3.eth.getTransactionCount(FROM, "pending"),
    chainId: await web3.eth.getChainId()
  };
  const signed = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  try { fs.appendFileSync("/tmp/fundtx.log", `${Date.now()} ${receipt.transactionHash}\n`); } catch {}
  await log(`✅ TX: ${receipt.transactionHash}`);
  return receipt;
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
    await log("===== CHAINGETCASH START =====");

    const [rate, gas] = await Promise.all([getEurEthRate(), getGasPrice()]);
    const bal = await getChainBalanceEth(BALANCE_ADDRESS);
    await log(`💠 Balance ${BALANCE_ADDRESS}: ${bal} ETH`);

    const orders = await fetchOrdersFromIF();
    if (!orders.length) {
      await log("ℹ️ Žiadne čakajúce objednávky");
      return res.json({ ok: true, balance_eth: bal, funded_count: 0 });
    }

    let funded = 0;
    for (const o of orders) {
      const addr = o.user_address, tid = Number(o.token_id);
      if (!addr || !tid) continue;
      const eur = Number(o.amount ?? o.amount_eur ?? 0);
      const eth = eur > 0 ? (eur / rate) : 0.0001;
      const r = await sendEthToNFT({ user_addr: addr, token_id: tid, ethAmount: eth, gasPrice: gas });
      funded++;
      await markOrderPaid(o.paymentIntentId || String(tid), r.transactionHash, addr);
    }

    await log(`✅ FUND DONE funded=${funded}`);
    res.json({ ok: true, balance_eth: bal, funded_count: funded });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}