<?php
include('background.php');
?>
<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CHAINVERS - Vyber obrázok</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin: 0;
            padding: 0;
            overflow-y: auto;
            height: 100vh;
        }

        h1 {
            margin-top: 20px;
            color: #333;
        }

        .gallery {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 15px;
            margin: 20px;
        }

        .gallery img {
            width: 200px;
            height: 200px;
            object-fit: cover;
            cursor: pointer;
            border: 2px solid #ccc;
            border-radius: 8px;
            transition: transform 0.3s, border-color 0.3s;
        }

        .gallery img:hover {
            transform: scale(1.05);
            border-color: #007bff;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
    </style>
</head>

<body>
    <div class="container">
        <h1>Vyber si obrázok</h1>
        <div class="gallery">
            <?php
            session_start();
            // Zabezpečiť, že používateľ je prihlásený
            if (!isset($_SESSION['user_address'])) {
                echo "<p>Prosím, prihláste sa pred výberom obrázka.</p>";
                exit;
            }

            $directory = "images"; // Priečinok s obrázkami
            $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp']; // Povolené formáty

            // Získať zoznam súborov v priečinku
            $files = scandir($directory);

            foreach ($files as $file) {
                // Overiť, či má súbor povolenú príponu
                $fileExtension = pathinfo($file, PATHINFO_EXTENSION);
                if (in_array(strtolower($fileExtension), $allowedExtensions)) {
                    // Skontrolujte správnosť cesty k obrázkom
                    $filePath = "$directory/$file";
                    echo "<a href='crop.php?image=" . urlencode($file) . "'>
                            <img src='$filePath' alt='$file'>
                          </a>";
                }
            }
            ?>
        </div>
    </div>
</body>
</html>