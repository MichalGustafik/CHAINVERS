export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = 'test_9G42azBgKQ83x68sQV65AH6sSVjseS'; // Použi svoj API kľúč Mollie

    const paymentData = {
        amount: {
            currency: "EUR",
            value: "102.25"
        },
        description: "Platba za objednávku",
        redirectUrl: "https://chainvers.free.nf/thankyou.php?payment_id={payment_id}",
        method: "creditcard",
        locale: "sk_SK",
    };

    const response = await fetch("https://api.mollie.com/v2/payments", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(paymentData)
    });

    const responseData = await response.json();

    if (responseData.id) {
        res.status(200).json({ payment_url: responseData._links.checkout.href });
    } else {
        res.status(400).json({ error: responseData.detail || "Neznáma chyba" });
    }
}