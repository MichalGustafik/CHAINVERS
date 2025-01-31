<?php
session_start();

// Funkcia na validáciu ETH adresy
function isValidEthAddress($address) {
    return preg_match('/^0x[a-fA-F0-9]{40}$/', $address);
}

// Skontroluj, či je používateľ už prihlásený
if (isset($_SESSION['user_address'])) {
    header("Location: gallery.php"); // Ak je prihlásený, presmeruj na gallery.php
    exit;
}

// Ak je prihlásenie cez peňaženku
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Získanie Ethereum adresy a hesla z formulára
    $ethAddress = trim($_POST['eth_address']);
    $password = trim($_POST['password']);

    // Skontrolujeme, či je adresa platná
    if (!isValidEthAddress($ethAddress)) {
        die("Neplatná Ethereum adresa.");
    }

    // Skontrolujeme, či existuje zložka pre danú adresu
    $userDir = "chainuserdata/$ethAddress";
    if (file_exists($userDir)) {
        // Načítame profilové údaje zo súboru
        $profileData = json_decode(file_get_contents("$userDir/profile.json"), true);

        // Skontrolujeme, či sa profil načítal správne
        if ($profileData === null || $profileData['password'] !== $password) {
            die("Neplatné heslo alebo profilové údaje.");
        }

        $_SESSION['user_address'] = $ethAddress;
        $_SESSION['nickname'] = $profileData['nickname'];
        $_SESSION['profile_photo'] = $profileData['profile_photo'];

        // Presmerovanie na gallery.php po úspešnom prihlásení
        header("Location: gallery.php");
        exit;
    } else {
        die("Používateľ neexistuje.");
    }
}
?>