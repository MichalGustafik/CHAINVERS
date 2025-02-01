// api/mollieWebhook.js

export default async function handler(req, res) {
    if (req.method === "POST") {
        const data = req.body;  // Údaje z webhooku Mollie
        
        console.log("Webhook prijatý: ", data);  // Logovanie dát pre kontrolu

        if (data && data.status === "paid") {
            // Ak platba prebehla úspešne
            console.log("Platba bola úspešne zaplatená.");
            // Tu môžeš pridať logiku, ako spracovať platbu (napr. ukladať do databázy)
            res.status(200).json({ status: "OK" });
        } else {
            // Ak platba neprešla
            console.log("Chyba pri platbe: ", data);
            res.status(400).json({ status: "Chyba" });
        }
    } else {
        // Ak nie je POST požiadavka
        res.status(405).json({ status: "Method Not Allowed" });
    }
}