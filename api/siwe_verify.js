// api/siwe_verify.js
// Vercel serverless: jednoduché overenie EIP-191 (personal_sign) správy.
// npm i ethers@6  (vo vercel projekte)

import { verifyMessage } from 'ethers';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }
    const { message, signature } = req.body || {};
    if (!message || !signature) {
      res.status(400).json({ ok:false, error:'missing_fields' });
      return;
    }
    // ethers v6: vráti overenú adresu
    const address = verifyMessage(message, signature);
    res.status(200).json({ ok: true, address: address.toLowerCase() });
  } catch (e) {
    res.status(400).json({ ok:false, error: e?.message || 'verify_failed' });
  }
}