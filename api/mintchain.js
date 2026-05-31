console.log("=== BOOT: CHAINVERS /api/copymint ===");

import Web3 from "web3";

export const maxDuration = 60;

const ABI = [

  {
    "inputs":[
      {
        "internalType":"uint256",
        "name":"originalId",
        "type":"uint256"
      }
    ],
    "name":"mintCopy",
    "outputs":[],
    "stateMutability":"payable",
    "type":"function"
  },

  {
    "inputs":[],
    "name":"mintFee",
    "outputs":[
      {
        "internalType":"uint256",
        "name":"",
        "type":"uint256"
      }
    ],
    "stateMutability":"view",
    "type":"function"
  },

  {
    "inputs":[
      {
        "internalType":"uint256",
        "name":"tokenId",
        "type":"uint256"
      }
    ],
    "name":"ownerOf",
    "outputs":[
      {
        "internalType":"address",
        "name":"",
        "type":"address"
      }
    ],
    "stateMutability":"view",
    "type":"function"
  }

];

function log(logs,msg,data=null){

  const line =
    `[${new Date().toISOString()}] ${msg}`;

  console.log(line,data || '');

  logs.push(
    data
      ? `${line} ${JSON.stringify(data)}`
      : line
  );
}

function parseErr(e){

  return (
    e?.data?.message ||
    e?.reason ||
    e?.message ||
    'Unknown error'
  );
}

export default async function handler(req,res){

  const logs = [];

  try{

    log(logs,"REQUEST_START",{
      method:req.method
    });

    if(req.method !== 'POST'){

      return res.status(405).json({
        ok:false,
        error:'Method not allowed',
        debug_log:logs
      });
    }

    const {
      action,
      original_id,
      user_address
    } = req.body || {};

    log(logs,"BODY",req.body);

    if(!original_id){

      return res.status(400).json({
        ok:false,
        error:'Missing original_id',
        debug_log:logs
      });
    }

    const rpc =
      process.env.PROVIDER_URL;

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    const web3 =
      new Web3(rpc);

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    /* ============================================
       VALIDATE ORIGINAL NFT
    ============================================ */

    let originalOwner = null;

    try{

      originalOwner =
        await contract.methods
          .ownerOf(original_id)
          .call();

      log(logs,"ORIGINAL_OWNER",{
        original_id,
        owner:originalOwner
      });

    }catch(e){

      log(logs,"OWNER_OF_FAIL",{
        error:parseErr(e)
      });

      return res.status(500).json({
        ok:false,
        error:'Original NFT does not exist',
        debug_log:logs
      });
    }

    /* ============================================
       MINT FEE
    ============================================ */

    let mintFee =
      web3.utils.toWei(
        '0.0002',
        'ether'
      );

    try{

      mintFee =
        await contract.methods
          .mintFee()
          .call();

    }catch(e){

      log(logs,"MINT_FEE_FAIL",{
        error:parseErr(e)
      });
    }

    log(logs,"MINT_FEE",{
      wei:mintFee,
      eth:web3.utils.fromWei(
        mintFee,
        'ether'
      )
    });

    /* ============================================
       SUCCESS
    ============================================ */

    return res.json({

      ok:true,

      mode:'wallet_mint',

      contract_address:
        contractAddress,

      original_id,

      user_address,

      mint_fee_wei:
        mintFee,

      mint_fee_eth:
        web3.utils.fromWei(
          mintFee,
          'ether'
        ),

      note:
        'Frontend wallet must call mintCopy(originalId).',

      debug_log:logs
    });

  }catch(e){

    log(logs,"HANDLER_FATAL",{
      error:parseErr(e)
    });

    return res.status(500).json({
      ok:false,
      error:parseErr(e),
      debug_log:logs
    });
  }
}