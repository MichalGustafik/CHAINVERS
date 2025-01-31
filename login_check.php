<?php
// login_check.php
session_start();

// Skontrolujeme, či je používateľ prihlásený
if(isset($_SESSION['user_id'])) {
    // Získame údaje používateľa z session
    $user_id = $_SESSION['user_id'];
    $user_address = $_SESSION['user_address'];
    $user_nickname = $_SESSION['user_nickname'];
    $user_photo = $_SESSION['user_photo']; // Predpokladáme, že fotka je uložená v session

    // Vrátime údaje do JavaScriptu vo formáte JSON
    echo json_encode([
        'logged_in' => true,
        'user_address' => $user_address,
        'user_nickname' => $user_nickname,
        'user_photo' => $user_photo
    ]);
} else {
    // Používateľ nie je prihlásený
    echo json_encode(['logged_in' => false]);
}
?>