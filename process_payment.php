<?php

// API kľúč Mollie
$apiKey = 'test_9G42azBgKQ83x68sQV65AH6sSVjseS';

// Prijatie údajov z InfintyFree
$data = json_decode(file_get_contents('php://input'), true);

// Údaje platby
$paymentData = [
    "amount" => [
        "currency" => $data['amount']['currency'],
        "value" => $data['amount']['value']
    ],
    "description" => $data['description'],
    "redirectUrl" => "https://chainvers.free.nf/thankyou.php?payment_id={payment_id}", // URL po úspešnej platbe
    "method" => $data['method'],
    "locale" => $data['locale']
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
    echo json_encode(['error' => 'Chyba pri vytváraní platby.']);
}
?>