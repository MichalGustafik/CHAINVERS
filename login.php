<?php
session_start();

// Funkcia na validáciu ETH adresy
function isValidEthAddress($address) {
    return preg_match('/^0x[a-fA-F0-9]{40}$/', $address);
}

// Ak je prihlásenie cez peňaženku
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Získanie Ethereum adresy a hesla z formulára
    $ethAddress = trim($_POST['eth_address']);
    $password = $_POST['password'];

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
        if ($profileData === null) {
            die("Nepodarilo sa načítať profilové údaje.");
        }

        // Overenie hesla
        if (!password_verify($password, $profileData['password'])) {
            die("Nesprávne heslo.");
        }

        // Uložíme údaje do session
        $_SESSION['user_address'] = $ethAddress;
        $_SESSION['nickname'] = $profileData['nickname'];
        $_SESSION['profile_photo'] = $profileData['profile_photo'];

        // Skontrolujeme, či existuje presmerovanie
        if (isset($_SESSION['redirect_to'])) {
            $redirectUrl = $_SESSION['redirect_to'];
            unset($_SESSION['redirect_to']); // Vymazanie uloženého presmerovania
            header("Location: $redirectUrl");
            exit;
        } else {
            // Ak neexistuje presmerovanie, presmeruj na galériu
            header("Location: gallery.php");
            exit;
        }
    } else {
        die("Používateľ neexistuje.");
    }
}
?>

<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CHAINVERS - Prihlásenie</title>
    <link rel="stylesheet" href="background.php">
    <style>
        body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 0;
            background-color: #2c2f56;
            color: white;
            text-align: center;
            overflow: hidden;
            position: relative;
        }

        h1 {
            font-size: 3em;
            color: #ffcc00;
            text-shadow: 3px 3px 10px rgba(0, 0, 0, 0.5);
            margin-top: 50px;
        }

        .form-container {
            background-color: rgba(0, 0, 0, 0.8);
            margin-top: 50px;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 0 20px rgba(255, 204, 0, 0.7);
            display: inline-block;
            text-align: left;
            width: 300px;
        }

        input[type="text"], input[type="password"] {
            padding: 15px;
            font-size: 18px;
            width: 100%;
            margin-bottom: 20px;
            border-radius: 10px;
            border: 2px solid #ffcc00;
            background-color: #333;
            color: #fff;
        }

        button {
            padding: 15px 30px;
            font-size: 18px;
            cursor: pointer;
            background-color: #ffcc00;
            border: none;
            border-radius: 10px;
            color: #2c2f56;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            width: 100%;
        }

        button:hover {
            background-color: #e6b800;
            transform: scale(1.1);
        }

        .register-link {
            margin-top: 20px;
            display: block;
            color: #ffcc00;
            text-decoration: none;
        }

        .register-link:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <h1>Prihlásenie cez peňaženku</h1>
    <div class="form-container">
        <form method="post">
            <input type="text" name="eth_address" placeholder="Zadajte svoju Ethereum adresu" required>
            <input type="password" name="password" placeholder="Zadajte svoje heslo" required>
            <button type="submit">Prihlásiť sa</button>
        </form>
        <a href="register.php" class="register-link">Nie som v Chainvers! Registrovať sa</a>
    </div>
</body>
</html>