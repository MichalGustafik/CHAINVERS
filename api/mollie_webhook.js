export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { id: paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: "Chýba payment_id" });
    }

    const mollieApiKey = "test_9G42azBgKQ83x68sQV65AH6sSVjseS";
    const mollieUrl = `https://api.mollie.com/v2/payments/${paymentId}`;

    try {
        const response = await fetch(mollieUrl, {
            method: "GET",
            headers: { "Authorization": `Bearer ${mollieApiKey}` }
        });

        const paymentData = await response.json();

        if (paymentData.status === "paid") {
            // Platba bola úspešná, presmerujeme na thankyou.php a odovzdáme ID platby
            const redirectUrl = `https://chainvers.free.nf/thankyou.php?payment_id=${paymentId}`;
            return res.redirect(redirectUrl);
        } else {
            console.log(`❌ Platba ${paymentId} nebola dokončená. Stav: ${paymentData.status}`);
            return res.status(200).send("Platba nebola úspešná.");
        }
    } catch (error) {
        console.error('Chyba pri komunikácii s Mollie API:', error);
        return res.status(500).send("Chyba pri spracovaní platby.");
    }
}