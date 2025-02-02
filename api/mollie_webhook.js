// api/mollie_webhook.js na Vercel

export default async function handler(req, res) {
    if (req.method === "POST") {
        const { id, status } = req.body;

        const mollieApiKey = "test_9G42azBgKQ83x68sQV65AH6sSVjseS";
        const url = `https://api.mollie.com/v2/payments/${id}`;

        try {
            const paymentResponse = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${mollieApiKey}`,
                },
            });
            const paymentData = await paymentResponse.json();

            if (paymentData.status === "paid") {
                // Presmerovanie na thankyou.php na InfinityFree s ID platby
                return res.redirect(`https://yourdomain.infinityfreeapp.com/thankyou.php?payment_id=${id}`);
            } else {
                // Ak platba nebola úspešná
                return res.status(400).json({ error: 'Platba nebola úspešná' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Chyba pri spracovaní platby' });
        }
    }
}