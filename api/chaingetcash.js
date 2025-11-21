import { ethers } from "ethers";
import fetch from "node-fetch";

export const config = {
  runtime: "nodejs"
};

const INF_BASE = "https://chainvers.free.nf/chainuserdata";  // InfinityFree

// Proxy script on InfinityFree that allows writing orders.json via POST
const INF_UPDATE = "https://chainvers.free.nf/update_order.php";

const ABI = [
  "function createOriginal(string,string,uint96,uint256) payable",
  "function mintCopy(uint256) payable",
  "function mintFee() view returns(uint256)"
];

export default async function handler(req, res) {
  const action = req.query.action || req.body?.action;

  try {
    if (action === "list") {
      return await listAllOrders(res);
    }

    if (action === "mint") {
      return await mintOrder(req, res);
    }

    if (action === "return") {
      return await returnOrder(req, res);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("ERR:", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ============================================================
   🔥 1) LIST: načíta všetky orders.json z chainuserdata
============================================================ */
async function listAllOrders(res) {
  const folders = await getUserFolders();
  let unpaid = [];
  let paid = [];

  for (const f of folders) {
    const orders = await loadOrdersForUser(f);
    if (!orders) continue;

    for (const o of orders) {
      o.user_folder = f;

      if (o.status.includes("Čaká") || o.chain_status === "pending") {
        unpaid.push(o);
      } else {
        paid.push(o);
      }
    }
  }

  return res.status(200).json({
    unpaid,
    paid,
    count: unpaid.length + paid.length
  });
}

/* ============================================================
   🔥 2) MINT: originál alebo kópia
============================================================ */
async function mintOrder(req, res) {
  const { payment_id, user_address, token_id, amount_eur, user_folder } =
    req.body;

  // prepare blockchain
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const RPC = process.env.RPC_URL;

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const mintFee = await contract.mintFee();

  let tx;
  if (!token_id || token_id == 0) {
    // 🔥 Mint originálu
    tx = await contract.createOriginal(
      "privateURI",
      "publicURI",
      500,
      1000,
      { value: mintFee }
    );
  } else {
    // 🔥 Mint kópie
    tx = await contract.mintCopy(token_id, { value: mintFee });
  }

  const receipt = await tx.wait();

  // 🔥 ULOŽIŤ SPÄŤ DO INF orders.json
  await updateInfinityFreeOrder({
    payment_id,
    user_folder,
    chain_status: "in_chain",
    status: "💰 Zaplatené",
    txHash: receipt.hash
  });

  return res.status(200).json({
    success: true,
    txHash: receipt.hash
  });
}

/* ============================================================
   🔥 3) RETURN: späť do unpaid
============================================================ */
async function returnOrder(req, res) {
  const { payment_id, user_folder } = req.body;

  await updateInfinityFreeOrder({
    payment_id,
    user_folder,
    chain_status: "pending",
    status: "🕓 Čaká"
  });

  return res.status(200).json({ success: true });
}

/* ============================================================
   UTILITIES
============================================================ */

// načíta priečinky
async function getUserFolders() {
  const html = await fetch(INF_BASE).then(r => r.text());
  const matches = [...html.matchAll(/href="([^"]+)\/"/g)];

  return matches
    .map(m => m[1])
    .filter(v => v.startsWith("0x")); // iba adresy
}

async function loadOrdersForUser(folder) {
  try {
    const url = `${INF_BASE}/${folder}/orders.json`;
    return await fetch(url).then(r => r.json());
  } catch {
    return null;
  }
}

// update jedného orderu
async function updateInfinityFreeOrder(data) {
  await fetch(INF_UPDATE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}
