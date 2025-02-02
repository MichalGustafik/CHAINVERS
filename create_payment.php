<?php

// API kľúč Mollie
$apiKey = 'test_9G42azBgKQ83x68sQV65AH6sSVjseS'; // Uisti sa, že je správny

// Prijatie údajov z InfintyFree (presnejšie z front-endu alebo ako JSON payload)
$data = json_decode(file_get_contents('php://input'), true);

// Skontroluj, či prišli dáta
if (!$data) {
    echo json_encode(['error' => 'Žiadne údaje na vytvorenie platby']);
    exit();
}

// Údaje platby
$paymentData = [
    "amount" => [
        "currency" => $data['amount']['currency'],
        "value" => $data['amount']['value'] * 100 // Mollie očakáva hodnotu v centoch
    ],
    "description" => $data['description'],
    "method" => $data['method'],
    "locale" => $data['locale'],
    "redirectUrl" => "https://chainvers.free.nf/thankyou.php?payment_id={payment_id}", // URL, na ktorú sa vráti platba po úspešnej transakcii
];

// Inicializácia cURL pre Mollie API
$ch = curl_init("https://api.mollie.com/v2/payments");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer " . $apiKey,
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($paymentData));

// Odošleme požiadavku
$response = curl_exec($ch);
curl_close($ch);

$responseData = json_decode($response, true);

// Ak odpoveď obsahuje platbu, pošleme URL na platobnú bránu
if (isset($responseData['id'])) {
    $paymentUrl = $responseData['_links']['checkout']['href'];
    echo json_encode(['payment_url' => $paymentUrl]);
} else {
    echo json_encode(['error' => 'Chyba pri vytváraní platby. Detaily: ' . $response]);
}
?>