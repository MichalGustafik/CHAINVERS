import Web3 from "web3";
import fetch from "node-fetch";

const PROVIDER_URL = process.env.PROVIDER_URL;
const PRIVATE_KEY  = process.env.PRIVATE_KEY;
const FROM         = process.env.FROM_ADDRESS;
const CONTRACT     = process.env.CONTRACT_ADDRESS;
const INF_FREE_URL = (process.env.INF_FREE_URL || "https://chainvers.free.nf").replace(/\/$/, "");

const web3 = new Web3(PROVIDER_URL);

export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(405).json({ok:false,error:"POST only"});
    const balWei = await web3.eth.getBalance(FROM);
    const balEth = Number(web3.utils.fromWei(balWei,"ether")).toFixed(6);
    console.log(`💠 Balance: ${balEth} ETH`);

    // pošli len číslo na IF (žiadne cookie)
    await fetch(`${INF_FREE_URL}/accptpay.php?action=balance&val=${balEth}`,{
      method:"GET",
      headers:{ "User-Agent":"ChainversBot/1.0" }
    });

    return res.json({ok:true,balance_eth:balEth});
  }catch(e){
    console.error("❌",e.message);
    res.status(500).json({ok:false,error:e.message});
  }
}