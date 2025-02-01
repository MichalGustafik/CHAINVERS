// api/mollieWebhook.js
export default async function handler(req, res) {
    if (req.method === "POST") {
        const data = req.body;  // Údaje z webhooku Mollie

        // Pridaj logovanie na kontrolu dát
        console.log("Webhook prijatý: ", data);

        // Skontroluj platbu
        if (data && data.status === "paid") {
            // Tu môžeš pridať logiku, ako spracovať platbu (napr. ukladať do databázy, vykonať akciu)
            console.log("Platba bola úspešne zaplatená.");
            res.status(200).json({ status: "OK" });
        } else {
            console.log("Chyba pri platbe: ", data);
            res.status(400).json({ status: "Chyba" });
        }
    } else {
        // Ak nie je POST požiadavka
        res.status(405).json({ status: "Method Not Allowed" });
    }
}