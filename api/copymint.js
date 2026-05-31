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
  }
];

export default async function handler(req,res){

  try{

    if(req.method !== 'POST'){
      return res.status(405).json({
        ok:false,
        error:'Method not allowed'
      });
    }

    const {
      action,
      original_id,
      user_address
    } = req.body || {};

    if(action !== 'mint_from_balance'){
      return res.status(400).json({
        ok:false,
        error:'Invalid action'
      });
    }

    if(!original_id || !user_address){
      return res.status(400).json({
        ok:false,
        error:'Missing original_id or user_address'
      });
    }

    const rpc =
      process.env.PROVIDER_URL;

    const pk =
      process.env.PRIVATE_KEY;

    const contractAddress =
      process.env.CONTRACT_ADDRESS;

    const web3 =
      new Web3(rpc);

    const account =
      web3.eth.accounts.privateKeyToAccount(pk);

    web3.eth.accounts.wallet.add(account);

    const contract =
      new web3.eth.Contract(
        ABI,
        contractAddress
      );

    const mintFee =
      web3.utils.toWei(
        '0.0002',
        'ether'
      );

    const gas =
      await contract.methods
        .mintCopy(original_id)
        .estimateGas({
          from:account.address,
          value:mintFee
        });

    const tx =
      await contract.methods
        .mintCopy(original_id)
        .send({
          from:account.address,
          gas,
          value:mintFee
        });

    return res.json({
      ok:true,
      tx:tx.transactionHash,
      original_id,
      user_address
    });

  }catch(e){

    return res.status(500).json({
      ok:false,
      error:e.message,
      stack:e.stack
    });
  }
}