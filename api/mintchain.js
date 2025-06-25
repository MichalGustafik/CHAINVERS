// Tento skript mintuje NFT cez Infura bez použitia balíka ethers, čisto cez JS a ručne podpísanú transakciu

const crypto = require("crypto"); const secp256k1 = require("secp256k1"); const rlp = require("rlp"); const { keccak256 } = require("js-sha3");

module.exports = async function handler(req, res) { const now = new Date().toISOString(); const log = (...args) => console.log([${now}], ...args);

if (req.method !== "POST") { log("❌ [MINTCHAIN] Nepodporovaná metóda:", req.method); return res.status(405).json({ error: "Method Not Allowed" }); }

try { const { wallet, metadataURI } = req.body; log("📥 [MINTCHAIN] Dáta:", req.body);

const PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/^0x/, "");
const PROVIDER_URL = process.env.PROVIDER_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CHAIN_ID = 84532;

const pk = Buffer.from(PRIVATE_KEY, "hex");
const address = "0x" + secp256k1.publicKeyCreate(pk, false).slice(1).toString("hex").slice(-40);

// 1. Ziskaj nonce a gasPrice
const rpcFetch = async (method, params) => {
  const res = await fetch(PROVIDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = await res.json();
  return json.result;
};

const [nonce, gasPrice] = await Promise.all([
  rpcFetch("eth_getTransactionCount", [address, "latest"]),
  rpcFetch("eth_gasPrice", [])
]);

// 2. Priprav inputy kontraktu
const methodId = "0x2f745c59"; // createOriginal(address,string)
const paddedAddress = wallet.toLowerCase().replace("0x", "").padStart(64, "0");
const encodedMetadata = Buffer.from(metadataURI, "utf8").toString("hex");
const length = encodedMetadata.length / 2;
const offset = (32).toString(16).padStart(64, "0");
const lenHex = length.toString(16).padStart(64, "0");
const data = methodId + paddedAddress + offset + lenHex + encodedMetadata.padEnd(Math.ceil(length / 32) * 64, "0");

// 3. Zostav transakciu
const tx = [
  nonce,
  gasPrice,
  "0x5208", // gasLimit 21000
  CONTRACT_ADDRESS,
  "0x0",
  data,
  CHAIN_ID,
  "0x",
  "0x"
];

const rlpEncoded = rlp.encode(tx);
const msgHash = Buffer.from(keccak256.update(rlpEncoded).digest());
const sig = secp256k1.ecdsaSign(msgHash, pk);

const v = CHAIN_ID * 2 + 35 + sig.recid;
const r = sig.signature.slice(0, 32);
const s = sig.signature.slice(32, 64);

const signedTx = rlp.encode([
  nonce,
  gasPrice,
  "0x5208",
  CONTRACT_ADDRESS,
  "0x0",
  data,
  "0x" + v.toString(16),
  "0x" + Buffer.from(r).toString("hex"),
  "0x" + Buffer.from(s).toString("hex")
]);

// 4. Odosli
const txRes = await fetch(PROVIDER_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_sendRawTransaction",
    params: ["0x" + signedTx.toString("hex")],
    id: 1
  })
});

const result = await txRes.json();
if (result.error) throw new Error("Chyba RPC: " + JSON.stringify(result.error));

return res.status(200).json({ success: true, txHash: result.result });

} catch (err) { log("❌ [MINTCHAIN ERROR]", err.message); return res.status(500).json({ success: false, error: err.message }); } };

