// api/mollie_payment.js

export default async function handler(req, res) {
    if (req.method === "POST") {
        const { id, status } = req.body;

        // Overenie platby cez Mollie API
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

            // Ak je platba úspešná
            if (paymentData.status === 'paid') {
                // Presmerovanie na 'thankyou.php' na InfinityFree
                return res.redirect(`https://yourdomain.infinityfreeapp.com/thankyou.php?payment_id=${id}`);
            } else {
                // Ak platba nie je úspešná, môžete to spracovať inak
                return res.status(400).json({ error: 'Platba nebola úspešná' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Chyba pri spracovaní platby' });
        }
    }
}