<?php
session_start();

// Skontrolovať, či je prítomné ID platby v URL
if (isset($_GET['payment_id'])) {
    $paymentId = $_GET['payment_id'];
    
    echo "Ďakujeme za platbu! ID platby: " . htmlspecialchars($paymentId);
} else {
    echo "Chyba: Platba nebola dokončená alebo ID platby nebolo odoslané.";
}
?>