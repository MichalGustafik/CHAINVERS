console.log("=== BOOT: CHAINVERS /api/copymint DEBUG ===");

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

function parseErr(e){

  return (
    e?.data?.message ||
    e?.reason ||
    e?.message ||
    'Unknown revert'
  );
}

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
      user_address,
      amount_eth,
      internal_payment_id
    } = req.body || {};

    log(logs,"BODY",req.body);

    if(action !== 'mint_from_balance'){

      return res.status(400).json({
        ok:false,
        error:'Invalid action',
        debug_log:logs
      });
    }

    if(!original_id){

      return res.status(400).json({
        ok:false,
        error:'Missing original_id',
        debug_log:logs
      });
    }

    if(!user_address){

      return res.status(400).json({
        ok:false,
        error:'Missing user_address',
        debug_log:logs
      });
    }

    const rpc =
      process.env.PROVIDER_URL;

    const pk =
      process.env.PRIVATE_KEY;

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    log(logs,"ENV_CHECK",{
      rpc_exists:!!rpc,
      pk_exists:!!pk,
      contract_exists:!!contractAddress
    });

    const web3 =
      new Web3(rpc);

    const account =
      web3.eth.accounts.privateKeyToAccount(pk);

    web3.eth.accounts.wallet.add(account);

    log(logs,"BACKEND_ACCOUNT",{
      address:account.address
    });

    const backendBalance =
      await web3.eth.getBalance(
        account.address
      );

    log(logs,"BACKEND_BALANCE",{
      wei:backendBalance,
      eth:web3.utils.fromWei(
        backendBalance,
        'ether'
      )
    });

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    let mintFee = '0';

    try{

      mintFee =
        await contract.methods
          .mintFee()
          .call();

      log(logs,"MINT_FEE",{
        wei:mintFee,
        eth:web3.utils.fromWei(
          mintFee,
          'ether'
        )
      });

    }catch(e){

      log(logs,"MINT_FEE_FAIL",{
        error:parseErr(e)
      });

      mintFee =
        web3.utils.toWei(
          '0.0002',
          'ether'
        );
    }

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
        error:parseErr(e),
        debug_log:logs
      });
    }

    /* =========================================================
       DEBUG CALL
    ========================================================= */

    try{

      const testCall =
        await contract.methods
          .mintCopy(original_id)
          .call({
            from:account.address,
            value:mintFee
          });

      log(logs,"CALL_OK",{
        testCall
      });

    }catch(e){

      log(logs,"CALL_REVERT_REASON",{
        error:parseErr(e),
        raw:e
      });

      return res.status(500).json({
        ok:false,
        error:parseErr(e),
        debug_log:logs
      });
    }

    /* =========================================================
       ESTIMATE GAS
    ========================================================= */

    let gas = 0;

    try{

      gas =
        await contract.methods
          .mintCopy(original_id)
          .estimateGas({
            from:account.address,
            value:mintFee
          });

      log(logs,"GAS_ESTIMATE_OK",{
        gas
      });

    }catch(e){

      log(logs,"GAS_ESTIMATE_FAIL",{
        error:parseErr(e),
        raw:e
      });

      return res.status(500).json({
        ok:false,
        error:parseErr(e),
        debug_log:logs
      });
    }

    /* =========================================================
       SEND TX
    ========================================================= */

    let tx;

    try{

      tx =
        await contract.methods
          .mintCopy(original_id)
          .send({
            from:account.address,
            gas:Math.ceil(gas * 1.2),
            value:mintFee
          });

      log(logs,"MINT_OK",{
        tx:tx.transactionHash
      });

    }catch(e){

      log(logs,"MINT_FAIL",{
        error:parseErr(e),
        raw:e
      });

      return res.status(500).json({
        ok:false,
        error:parseErr(e),
        debug_log:logs
      });
    }

    return res.json({
      ok:true,
      tx:tx.transactionHash,
      original_id,
      user_address,
      internal_payment_id,
      backend_wallet:account.address,
      note:
        'Current contract mints copy to msg.sender/backend wallet.',
      debug_log:logs
    });

  }catch(e){

    log(logs,"HANDLER_FATAL",{
      error:parseErr(e),
      raw:e
    });

    return res.status(500).json({
      ok:false,
      error:parseErr(e),
      debug_log:logs
    });
  }
}