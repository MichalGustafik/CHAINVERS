// VERCEL-COMPATIBLE MINTCHAIN.JS USING VIEM (lightweight, no Ethers)

import { createWalletClient, custom, encodeFunctionData, http } from 'viem'; import { baseSepolia } from 'viem/chains';

export default async function handler(req, res) { const now = new Date().toISOString(); const log = (...args) => console.log([${now}], ...args);

if (req.method !== 'POST') { log('❌ [CHYBA] Nepodporovaná HTTP metóda:', req.method); return res.status(405).json({ error: 'Method Not Allowed' }); }

const { metadataURI, walletAddress, crop_id } = req.body; if (!metadataURI || !walletAddress || !crop_id) { log('⚠️ [MINTCHAIN] Chýbajú parametre metadataURI, walletAddress alebo crop_id.'); return res.status(400).json({ error: 'Missing required parameters' }); }

const providerUrl = process.env.PROVIDER_URL; const privateKey = process.env.PRIVATE_KEY; const contractAddress = process.env.CONTRACT_ADDRESS;

if (!providerUrl || !privateKey || !contractAddress) { log('⚠️ [MINTCHAIN] Chýbajú environment variables.'); return res.status(400).json({ error: 'Missing environment variables' }); }

try { const client = createWalletClient({ chain: baseSepolia, transport: http(providerUrl), account: privateKey, });

const calldata = encodeFunctionData({
  abi: [
    {
      type: 'function',
      name: 'createOriginal',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'imageURI', type: 'string' },
        { name: 'cropId', type: 'string' },
        { name: 'to', type: 'address' },
      ],
      outputs: [],
    },
  ],
  functionName: 'createOriginal',
  args: [metadataURI, crop_id, walletAddress],
});

log('📤 [VIEM] Odosielam transakciu...');
const hash = await client.sendTransaction({
  to: contractAddress,
  data: calldata,
  chain: baseSepolia,
});

log('✅ [MINTCHAIN] Transakcia hash:', hash);
return res.status(200).json({ success: true, txHash: hash });

} catch (err) { log('❌ [MINTCHAIN ERROR]', err.message); return res.status(500).json({ error: err.message }); } }

