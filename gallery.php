<?php
session_start();
include('background.php');

// Skontrolovať, či je používateľ prihlásený
if (!isset($_SESSION['user_address'])) {
    echo "<p>Prosím, prihláste sa pred výberom obrázka.</p>";
    exit;
}

$directory = "images"; // Priečinok s obrázkami
$allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp']; // Povolené formáty

// Skontrolovať, či priečinok existuje
if (!is_dir($directory)) {
    echo "<p>Priečinok <strong>$directory</strong> neexistuje!</p>";
    exit;
}

// Získať zoznam súborov v priečinku
$files = scandir($directory);
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
            $foundImages = false;

            foreach ($files as $file) {
                // Preskočiť "." a ".."
                if ($file === '.' || $file === '..') continue;

                // Overiť, či má súbor povolenú príponu
                $fileExtension = pathinfo($file, PATHINFO_EXTENSION);
                if (in_array(strtolower($fileExtension), $allowedExtensions)) {
                    $filePath = "$directory/$file"; // Relatívna cesta

                    // Skontrolovať, či súbor existuje
                    if (!file_exists($filePath)) continue;

                    echo "<a href='crop.php?image=" . urlencode($file) . "'>
                            <img src='$filePath' alt='$file'>
                          </a>";
                    $foundImages = true;
                }
            }

            // Ak neboli nájdené žiadne obrázky
            if (!$foundImages) {
                echo "<p>Žiadne obrázky neboli nájdené....</p>";
            }
            ?>
        </div>
    </div>
</body>
</html>