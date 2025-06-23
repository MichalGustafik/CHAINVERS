// File: /api/mint.js on Vercel backend

import { ethers } from "ethers";

const contractAddress = "0x03EE5aB10e4C5DC6ED1693b497BEA25a99b51834"; const privateKey = "04ca1a4ed6521ed77d1dab294bc133702068199a89268057700acaeb0ad8c97d"; const provider = new ethers.JsonRpcProvider("https://base-sepolia.infura.io/v3/383a672d0d4849cd8eeaebf2a0d6dd66"); const wallet = new ethers.Wallet(privateKey, provider);

// Minimal ABI for createOriginal function const abi = [ "function createOriginal(address to, string memory tokenURI) public returns (uint256)" ];

export default async function handler(req, res) { if (req.method !== "POST") { return res.status(405).json({ error: "Method not allowed" }); }

const { to, tokenURI } = req.body;

if (!to || !tokenURI) { return res.status(400).json({ error: "Missing parameters" }); }

try { const contract = new ethers.Contract(contractAddress, abi, wallet); const tx = await contract.createOriginal(to, tokenURI); const receipt = await tx.wait();

const event = receipt.logs.find(log => log.topics.length > 0);
const tokenId = parseInt(event.topics[3], 16); // Assuming tokenId is third topic

return res.status(200).json({ success: true, tokenId });

} catch (err) { console.error(err); return res.status(500).json({ error: "Minting failed" }); } }

