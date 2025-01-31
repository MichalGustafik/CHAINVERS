<?php
// register.php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Načítanie údajov z formulára
    $ethAddress = trim($_POST['eth_address']);
    $nickname = trim($_POST['nickname']);
    $email = trim($_POST['email']);
    $phone = trim($_POST['phone']);
    $address = trim($_POST['address']);
    $country = trim($_POST['country']);
    $password = $_POST['password'];
    $profilePhoto = $_FILES['profile_photo'];
    $gdprConsent = isset($_POST['gdpr_consent']) ? true : false;

    // Základné kontroly
    if (empty($ethAddress) || empty($nickname) || empty($email) || empty($phone) || empty($address) || empty($country) || empty($password)) {
        die("All fields are required.");
    }
    if (!$gdprConsent) {
        die("You must agree to the GDPR terms.");
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        die("Invalid email format.");
    }

    // Hashovanie hesla
    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);

    // Vytvorenie zložky pre užívateľa
    $userDir = "chainuserdata/$ethAddress";
    if (!file_exists($userDir)) {
        mkdir($userDir, 0777, true);
    }

    // Uloženie profilovej fotky
    $profilePhotoPath = null;
    if ($profilePhoto['error'] === UPLOAD_ERR_OK) {
        $allowedExtensions = ['jpg', 'jpeg', 'png'];
        $ext = strtolower(pathinfo($profilePhoto['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, $allowedExtensions)) {
            die("Only JPG, JPEG, and PNG files are allowed.");
        }
        $profilePhotoPath = "$userDir/profile_photo.$ext";
        move_uploaded_file($profilePhoto['tmp_name'], $profilePhotoPath);
    }

    // Uloženie údajov do JSON súboru
    $profileData = [
        "eth_address" => $ethAddress,
        "nickname" => $nickname,
        "email" => $email,
        "phone" => $phone,
        "address" => $address,
        "country" => $country,
        "password" => $hashedPassword,
        "profile_photo" => $profilePhotoPath
    ];
    file_put_contents("$userDir/profile.json", json_encode($profileData, JSON_PRETTY_PRINT));

    echo "Registration successful! You can now log in.";
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register - CHAINVERS</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <?php include 'background.php'; ?>

    <div class="register-container">
        <h2>Create Your CHAINVERS Account</h2>
        <form method="post" enctype="multipart/form-data" class="register-form">
            <input type="text" name="eth_address" placeholder="ETH Address" required>
            <input type="text" name="nickname" placeholder="Nickname" required>
            <input type="email" name="email" placeholder="Email" required>
            <input type="text" name="phone" placeholder="Phone" required>
            <textarea name="address" placeholder="Complete Address" required></textarea>
            <input type="text" name="country" placeholder="Country" required>
            <input type="password" name="password" placeholder="Password" required>
            <input type="file" name="profile_photo" accept="image/*" required>
            <div class="gdpr-consent">
                <input type="checkbox" name="gdpr_consent" value="1" required> I agree to the GDPR terms.
            </div>
            <button type="submit">Register</button>
        </form>
    </div>

    <style>
        /* Základné štýly pre stránku */
        body {
            margin: 0;
            font-family: Arial, sans-serif;
            color: white;
            background: #000; /* Čierne pozadie */
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh; /* Celá výška okna */
            background: linear-gradient(to right, #1e3c72, #2a5298); /* Modrá gradient */
            overflow: hidden; /* Zabránime pretečeniu */
        }

        /* Kontajner formulára */
        .register-container {
            padding: 30px;
            background: rgba(0, 0, 0, 0.7);
            border-radius: 15px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 0 25px rgba(255, 255, 255, 0.7);
            text-align: center;
            position: relative;
            z-index: 1;
            max-height: 90vh; /* Maximalizujeme výšku na 90% obrazovky */
            overflow-y: auto; /* Pridáme scroll na prípade overflow */
        }

        .register-container h2 {
            margin-bottom: 20px;
            color: #f0e68c; /* Žltá */
            font-size: 26px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        /* Formulár */
        .register-form input, .register-form textarea {
            width: 100%;
            padding: 14px;
            margin: 10px 0;
            border-radius: 10px;
            border: none;
            background-color: #2a2a2a; /* tmavá farba */
            color: white;
            font-size: 16px;
        }

        .register-form textarea {
            resize: vertical;
        }

        .register-form button {
            width: 100%;
            padding: 14px;
            background-color: #4b0082; /* Fialová */
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 18px;
            cursor: pointer;
        }

        .register-form button:hover {
            background-color: #8a2be2; /* Svetlá fialová */
        }

        .gdpr-consent {
            margin-top: 15px;
            font-size: 14px;
            color: #f0e68c; /* Žltá */
        }

        .gdpr-consent input {
            margin-right: 10px;
        }

        /* Responsívny dizajn */
        @media (max-width: 600px) {
            body {
                overflow: auto; /* Umožní rolovanie na menších obrazovkách */
            }

            .register-container {
                padding: 20px;
                width: 85%;
                max-height: none; /* Odstránime limit výšky na mobilných zariadeniach */
            }

            .register-container h2 {
                font-size: 22px;
            }

            .register-form input, .register-form textarea, .register-form button {
                font-size: 16px;
            }
        }
    </style>
</body>
</html>