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

<!-- Načítanie pozadia zo background.php -->
<?php include('background.php'); ?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CHAINVERS - Prihlásenie</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #2c2f56;
            color: #fff;
            text-align: center;
            overflow: hidden;
        }

        h1 {
            font-size: 2.5em;
            color: #ffcc00;
            text-shadow: 3px 3px 10px rgba(0, 0, 0, 0.3);
        }

        form {
            margin-top: 50px;
            padding: 30px;
            background-color: rgba(0, 0, 0, 0.7);
            border-radius: 10px;
            box-shadow: 0 0 15px rgba(255, 204, 0, 0.5);
        }

        input[type="text"], input[type="password"] {
            padding: 15px;
            font-size: 18px;
            width: 300px;
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
        }

        button:hover {
            background-color: #e6b800;
            transform: scale(1.1);
        }

        .star {
            position: absolute;
            width: 2px;
            height: 2px;
            background-color: #fff;
            border-radius: 50%;
            opacity: 0.8;
        }

        .qr-code {
            position: absolute;
            width: 50px;
            height: 50px;
            background-image: url('qr-placeholder.png'); /* Placeholder image for QR codes */
            background-size: cover;
            animation: fly 5s infinite;
            cursor: pointer; /* Enable clicking on the QR code */
        }

        @keyframes fly {
            0% { transform: translate(0, 0); }
            100% { transform: translate(100vw, 100vh); }
        }
    </style>
</head>
<body>
    <h1>Prihlásenie cez peňaženku</h1>

    <!-- Zobrazenie prihlásenia iba po kliknutí na lietajúci produkt -->
    <div id="login-form-container" style="display: none;">
        <form method="post">
            <input type="text" name="eth_address" placeholder="Zadajte svoju Ethereum adresu" required>
            <input type="password" name="password" placeholder="Zadajte svoje heslo" required>
            <button type="submit">Prihlásiť sa</button>
        </form>
        <p>Nemáte účet? <a href="register.php" style="color: #ffcc00;">Zaregistrujte sa tu</a></p>
    </div>

    <!-- Lietajúce QR kódy -->
    <script>
        document.addEventListener('mousemove', (e) => {
            const starCount = 5; // Počet produktov
            const starsContainer = document.body;
            for (let i = 0; i < starCount; i++) {
                let qrCode = document.createElement('div');
                qrCode.classList.add('qr-code');
                starsContainer.appendChild(qrCode);

                const qrX = e.pageX + Math.random() * 100 - 50;
                const qrY = e.pageY + Math.random() * 100 - 50;

                qrCode.style.left = qrX + 'px';
                qrCode.style.top = qrY + 'px';

                // Aktivuj prihlásenie po kliknutí na QR kód
                qrCode.addEventListener('click', function() {
                    document.getElementById('login-form-container').style.display = 'block';
                });

                setTimeout(() => {
                    qrCode.style.opacity = '0';
                    qrCode.style.transition = 'all 1s ease-out';
                }, 100);

                setTimeout(() => {
                    qrCode.remove();
                }, 2000);
            }
        });

        // Presmerovanie na login.php po kliknutí na obrazovku
        document.body.addEventListener('click', function() {
            window.location.href = 'login.php';
        });
    </script>
</body>
</html>