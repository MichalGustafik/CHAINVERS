export default async function handler(req, res) {
  try {
    const base = process.env.CIRCLE_BASE || "https://api.circle.com";
    const response = await fetch(`${base}/v1/address-book/addresses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CIRCLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "blockchain",
        address: process.env.TREASURY_ADDRESS,   // tvoja EOA adresa
        label: "Chainvers Treasury",
        chain: process.env.PAYOUT_CHAIN || "BASE"
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    // id býva v data.data.id alebo data.data.addressId
    const addressId = data?.data?.id || data?.data?.addressId;
    return res.status(200).json({ ok: true, addressId, raw: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}