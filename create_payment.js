// server.js - Vercel API Endpoint

const fetch = require('node-fetch'); // Pre komunikáciu s Mollie API

module.exports = async (req, res) => {
  const data = req.body; // Získanie údajov o platbe

  const mollieApiKey = 'test_9G42azBgKQ83x68sQV65AH6sSVjseS'; // Mollie API kľúč
  const url = 'https://api.mollie.com/v2/payments'; // Mollie API URL

  // Konfigurácia pre Mollie API
  const requestData = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${mollieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: data.amount,
      description: data.description,
      method: data.method,
      locale: data.locale,
      redirectUrl: `https://chainvers.free.nf/thankyou.php?payment_id={payment_id}`, // Dynamické ID platby
    }),
  };

  try {
    const response = await fetch(url, requestData);
    const paymentResponse = await response.json();

    if (paymentResponse && paymentResponse._links && paymentResponse._links.checkout) {
      const paymentUrl = paymentResponse._links.checkout.href; // URL pre platobnú bránu
      res.json({ payment_url: paymentUrl }); // Odoslanie URL späť na InfinityFree
    } else {
      res.status(400).json({ error: 'Chyba pri vytváraní platby.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Chyba pri komunikácii s Mollie API.' });
  }
};