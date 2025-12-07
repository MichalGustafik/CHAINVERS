console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (FINAL NO ESTIMATE) ===");

import Web3 from "web3";

/* ============================================================
   BODY PARSER
============================================================ */
async function parseBody(req) {
    return new Promise(resolve => {
        let raw = "";
        req.on("data", c => raw += c);
        req.on("end", () => {
            try { resolve(JSON.parse(raw || "{}")); }
            catch { resolve({}); }
        });
    });
}

/* ============================================================
   RPC INIT
============================================================ */
const RPCs = [
    process.env.PROVIDER_URL,
    "https://base.llamarpc.com",
    "https://base.publicnode.com",
    "https://base.blockpi.network/v1/rpc/public",
    "https://rpc.ankr.com/base"
].filter(Boolean);

async function initWeb3() {
    for (const rpc of RPCs) {
        try {
            const w3 = new Web3(rpc);
            await w3.eth.getBlockNumber();
            console.log("[RPC OK]", rpc);
            return w3;
        } catch {}
    }
    throw new Error("NO RPC AVAILABLE");
}

/* ============================================================
   ABI backendWithdraw only
============================================================ */
const ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "to", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "backendWithdraw",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

/* ============================================================
   MAIN HANDLER
============================================================ */
export default async function handler(req, res) {

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (req.method === "OPTIONS") return res.status(200).end();

    const body = await parseBody(req);
    const action = body.action || "none";

    console.log("=== API CALL:", action);

    if (action !== "withdraw") {
        return res.json({ ok:false, error:"Invalid action" });
    }

    try {
        const web3 = await initWeb3();
        const contractAddr = process.env.CONTRACT_ADDRESS;

        const contract = new web3.eth.Contract(ABI, contractAddr);
        const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
        web3.eth.accounts.wallet.add(owner);

        const user = body.user;
        const amount = Number(body.amount);

        if (!user || !user.startsWith("0x"))
            return res.json({ ok:false, error:"Invalid user address" });

        if (amount <= 0)
            return res.json({ ok:false, error:"Amount must be > 0" });

        console.log("[WITHDRAW] requested:", amount, "ETH");

        // ------------------------------------------------------------
        // WEI
        const amountWei = BigInt(web3.utils.toWei(amount.toString(), "ether"));

        // ------------------------------------------------------------
        // FIXED GAS LIMIT (NO estimateGas!)
        const gasLimit = BigInt(100000);

        const gasPrice = BigInt(await web3.eth.getGasPrice());
        const gasCost = gasLimit * gasPrice;

        console.log("[GAS COST WEI]", gasCost.toString());

        const finalWei = amountWei - gasCost;

        if (finalWei <= 0n) {
            return res.json({
                ok:false,
                error:"Zadaná suma nepokryje poplatky (gas)."
            });
        }

        console.log("[FINAL WEI TO SEND]", finalWei.toString());

        // ------------------------------------------------------------
        // SEND TX
        const tx = await contract.methods.backendWithdraw(user, finalWei.toString())
            .send({
                from: owner.address,
                gas: Number(gasLimit)
            });

        console.log("[TX SUCCESS]", tx.transactionHash);

        return res.json({
            ok:true,
            tx: tx.transactionHash,
            finalWei: finalWei.toString(),
            finalEth: web3.utils.fromWei(finalWei.toString(), "ether")
        });

    } catch (e) {
        console.log("[FATAL]", e.message);
        return res.json({ ok:false, error:e.message });
    }
}