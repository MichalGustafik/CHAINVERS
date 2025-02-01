// Funkcia na načítanie stavu platby
async function checkPaymentStatus(paymentId) {
    const response = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer test_9G42azBgKQ83x68sQV65AH6sSVjseS',
            'Content-Type': 'application/json',
        }
    });

    const paymentData = await response.json();

    if (paymentData.status === 'paid') {
        // Ak je platba zaplatená, presmeruj späť na InfintyFree stránku
        window.location.href = `https://chainvers.free.nf/thankyou.php?payment_id=${paymentId}`;
    } else {
        // Ak platba nie je zaplatená, informuj používateľa
        document.getElementById("paymentStatus").innerText = 'Platba nebola úspešná. Skúste to prosím znova.';
    }
}

// Získanie payment_id z URL
const urlParams = new URLSearchParams(window.location.search);
const paymentId = urlParams.get('payment_id');

// Skontrolovanie stavu platby
if (paymentId) {
    checkPaymentStatus(paymentId);
} else {
    document.getElementById("paymentStatus").innerText = 'Chyba: ID platby nebolo zadané.';
}