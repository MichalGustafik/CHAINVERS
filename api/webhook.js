export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        console.log('Webhook received:', body);
        res.status(200).json({ status: 'Webhook processed' });

        // Odošleme dáta do InfinityFree
        fetch("https://chainvers.free.nf/webhook.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body
        }).catch(err => console.error("Error sending to InfinityFree:", err));
    });
}