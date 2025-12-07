console.log("=== BOOT: CHAINVERS chaingetcashdraw.js (NO TOKEN-ID MODE, FIXED GAS) ===");

import Web3 from "web3";

/* ============================================================
   SAFE BODY PARSER (Vercel)
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
   RPC FALLBACKS
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
        } catch (e) {
            console.log("[RPC FAIL]", rpc, e.message);
        }
    }
    throw new Error("No working RPC available");
}

/* ============================================================
   ABI – only backendWithdraw(to,amount)
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

    console.log("=== API CALL chaingetcashdraw ===");

    const body = await parseBody(req);
    const action = body.action || "none";

    console.log("ACTION:", action);

    try {
        const web3 = await initWeb3();
        const contractAddr = process.env.CONTRACT_ADDRESS;
        const contract = new web3.eth.Contract(ABI, contractAddr);

        const owner = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
        web3.eth.accounts.wallet.add(owner);

        console.log("OWNER:", owner.address);

        /* ============================================================
           ACTION: withdraw (NO TOKEN ID)
        ============================================================ */
        if (action === "withdraw") {

            const user   = body.user;
            const amount = Number(body.amount);

            if (!user || !user.startsWith("0x")) {
                return res.json({ ok:false, error:"Invalid user address" });
            }
            if (amount <= 0) {
                return res.json({ ok:false, error:"Amount must be > 0" });
            }

            console.log("[WITHDRAW] USER:", user, "REQUESTED:", amount);

            // FULL AMOUNT IN WEI
            const amountWei = BigInt(web3.utils.toWei(amount.toString(), "ether"));

            /* ============================================================
               FIXED GAS ESTIMATION (IMPORTANT FIX)
               → we NEVER estimateGas using large amount (it reverts)
               → we estimate using EXACT 1 wei (always safe)
            ============================================================ */
            const minimalWei = "1"; // 1 wei

            let gas;
            try {
                gas = await contract.methods.backendWithdraw(user, minimalWei)
                    .estimateGas({ from: owner.address });
            } catch (e) {
                console.log("[GAS ERROR]", e.message);
                return res.json({ ok:false, error:"Gas estimation failed: "+e.message });
            }

            const gasPrice = BigInt(await web3.eth.getGasPrice());
            const gasCost  = BigInt(gas) * gasPrice;

            console.log("[GAS] gas =", gas, "gasPrice =", gasPrice.toString(), "gasCost =", gasCost.toString());

            /* ============================================================
               FINAL AMOUNT AFTER GAS DEDUCTION
            ============================================================ */
            const finalWei = amountWei - gasCost;

            if (finalWei <= 0n) {
                return res.json({
                    ok:false,
                    error:"Zadaná suma nepokryje gas. Zadaj vyššiu sumu."
                });
            }

            console.log("[FINAL WEI TO SEND]:", finalWei.toString());

            /* ============================================================
               SEND TRANSACTION backendWithdraw(user, finalWei)
            ============================================================ */
            let tx;
            try {
                tx = await contract.methods.backendWithdraw(user, finalWei.toString())
                    .send({ from: owner.address, gas });
            } catch (e) {
                console.log("[TX ERROR]", e.message);
                return res.json({ ok:false, error:"TX failed: "+e.message });
            }

            console.log("[TX SUCCESS]:", tx.transactionHash);

            return res.json({
                ok: true,
                tx: tx.transactionHash,
                sentWei: finalWei.toString(),
                sentEth: web3.utils.fromWei(finalWei.toString(), "ether")
            });
        }

        return res.json({ ok:false, error:"Unknown action" });

    } catch (e) {
        console.log("[FATAL ERROR]", e);
        return res.json({ ok:false, error: e.message });
    }
}