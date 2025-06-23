// ===================== mint.js (Vercel) =====================

import { ethers } from 'ethers'; import axios from 'axios';

export default async function handler(req, res) { if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

console.log('🔧 1️⃣ Mint endpoint invoked.');

const { imageUrl, userAddress } = req.body; if (!imageUrl || !userAddress) { return res.status(400).json({ error: 'Missing imageUrl or userAddress' }); }

try { console.log('👉 2️⃣ Fetching image from:', imageUrl); const imageResp = await axios.get(imageUrl, { responseType: 'arraybuffer' }); console.log('✅ 3️⃣ Image fetched, size:', imageResp.data.length);

// Upload image to Pinata
const imageUpload = await axios.post(
  'https://api.pinata.cloud/pinning/pinFileToIPFS',
  imageResp.data,
  {
    maxBodyLength: Infinity,
    headers: {
      'Content-Type': 'multipart/form-data',
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJmNzZhNDcxZC1mODJmLTQyZmEtYTU5Mi04ZTAyODNmZDcwZmQiLCJlbWFpbCI6ImNoYWludmVyc0BnbWFpbC5jb20iLCJpYXQiOjE3MTg4NzAwNTN9.BKYiFMKr6thElkgBWIFUqzH53CVxEzNOsECm-4RDq4g'
    }
  }
);
const imageHash = imageUpload.data.IpfsHash;
console.log('✅ 4️⃣ Image uploaded. Hash:', imageHash);

// Create metadata
const metadata = {
  name: 'CHAINVERS NFT',
  description: 'Unique cropped NFT image.',
  image: `ipfs://${imageHash}`
};

const metadataUpload = await axios.post(
  'https://api.pinata.cloud/pinning/pinJSONToIPFS',
  metadata,
  {
    headers: {
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJmNzZhNDcxZC1mODJmLTQyZmEtYTU5Mi04ZTAyODNmZDcwZmQiLCJlbWFpbCI6ImNoYWludmVyc0BnbWFpbC5jb20iLCJpYXQiOjE3MTg4NzAwNTN9.BKYiFMKr6thElkgBWIFUqzH53CVxEzNOsECm-4RDq4g'
    }
  }
);
const metadataHash = metadataUpload.data.IpfsHash;
const metadataUri = `ipfs://${metadataHash}`;
console.log('✅ 5️⃣ Metadata uploaded. URI:', metadataUri);

// Mint via smart contract
const provider = new ethers.providers.JsonRpcProvider(
  'https://base-sepolia.infura.io/v3/383a672d0d4849cd8eeaebf2a0d6dd66'
);
const wallet = new ethers.Wallet(
  '04ca1a4ed6521ed77d1dab294bc133702068199a89268057700acaeb0ad8c97d',
  provider
);
const abi = [
  'function createOriginal(address to, string memory tokenURI) public returns (uint256)'
];
const contract = new ethers.Contract(
  '0x03EE5aB10e4C5DC6ED1693b497BEA25a99b51834',
  abi,
  wallet
);

console.log('🚀 6️⃣ Sending mint transaction...');
const tx = await contract.createOriginal(userAddress, metadataUri);
console.log('📝 7️⃣ Tx hash:', tx.hash);

const receipt = await tx.wait();
console.log('✅ 8️⃣ Mint success. Tx receipt:', receipt.transactionHash);

res.status(200).json({ success: true, tx: receipt.transactionHash });

} catch (err) { console.error('❌ Minting error:', err); res.status(500).json({ error: 'Minting failed', message: err.message }); } } // End of mint.js

