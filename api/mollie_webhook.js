// api/mollie_webhook.js
export default async function handler(req, res) {
    // Zkontrolujte, že požadavek je POST
    if (req.method === "POST") {
        const { id, status } = req.body;

        const mollieApiKey = "test_9G42azBgKQ83x68sQV65AH6sSVjseS"; // nahraďte svým testovacím API klíčem
        const url = `https://api.mollie.com/v2/payments/${id}`;

        try {
            // Získejte údaje o platbě z Mollie API
            const paymentResponse = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${mollieApiKey}`,
                },
            });

            const paymentData = await paymentResponse.json();

            if (paymentData.status === "paid") {
                // Platba byla úspěšná, přesměrujte na stránku thankyou.php na InfinityFree
                return res.redirect(`https://yourdomain.infinityfreeapp.com/thankyou.php?payment_id=${id}`);
            } else {
                // Platba není dokončena
                return res.status(400).json({ error: 'Platba neprošla.' });
            }
        } catch (error) {
            console.error("Chyba při zpracování platby:", error);
            return res.status(500).json({ error: 'Chyba při zpracování platby' });
        }
    } else {
        // Pokud požadavek není POST, vraťte chybu
        return res.status(405).json({ error: 'Metoda není povolena.' });
    }
}