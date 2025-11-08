import Web3 from "web3";
import fetch from "node-fetch";

const web3 = new Web3(process.env.PROVIDER_URL);
const FROM = process.env.FROM_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

export const config = { api: { bodyParser: true } };

async function sendLog(msg) {
  try {
    await fetch(`${INF_FREE_URL}/accptpay.php?action=save_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ChainversBot/1.0",
        "Referer": INF_FREE_URL + "/"
      },
      body: new URLSearchParams({ message: `[${new Date().toISOString()}] ${msg}` })
    });
  } catch {}
}

const log = async (...a) => {
  const m = a.join(" ");
  console.log(m);
  await sendLog(m);
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "POST only" });

    await log("===== CHAINGETCASH START =====");

    const balWei = await web3.eth.getBalance(FROM);
    const balEth = Number(web3.utils.fromWei(balWei, "ether")).toFixed(6);
    await log(`💠 Balance ${FROM}: ${balEth} ETH`);

    // zapíš zostatok na IF
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`, {
      method: "GET",
      headers: {
        "User-Agent": "ChainversBot/1.0",
        "Referer": INF_FREE_URL + "/"
      }
    });

    res.json({ ok: true, balance_eth: balEth });
  } catch (e) {
    await log(`❌ ERROR: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
}