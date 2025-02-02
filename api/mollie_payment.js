export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { amount, currency, description } = req.body;

    const mollieApiKey = "test_9G42azBgKQ83x68sQV65AH6sSVjseS";
    const mollieUrl = "https://api.mollie.com/v2/payments";

    const response = await fetch(mollieUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${mollieApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            amount: { currency, value: amount },
            description,
            redirectUrl: `https://chainvers.free.nf/thankyou.php?payment_id={payment_id}`,
            webhookUrl: "https://chainvers.vercel.app/api/mollie_webhook"
        })
    });

    const data = await response.json();

    if (data.id) {
        res.json({ payment_url: data._links.checkout.href });
    } else {
        res.status(400).json({ error: "Chyba pri vytváraní platby", detail: data.detail });
    }
}