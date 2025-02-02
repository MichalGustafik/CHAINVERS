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

    const response = await fetch(mollieUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${mollieApiKey}` }
    });

    const paymentData = await response.json();

    if (paymentData.status === "paid") {
        // Môžeš tu uložiť do databázy, že platba prebehla
        console.log(`✅ Platba ${paymentId} bola úspešne dokončená.`);
    } else {
        console.log(`❌ Platba ${paymentId} nebola dokončená. Stav: ${paymentData.status}`);
    }

    res.status(200).send("OK");
}