<?php
session_start();

// Skontrolovať, či je používateľ prihlásený
if (!isset($_SESSION['user_address'])) {
    header("Location: login.php");
    exit();
}

// Získať vybraný obrázok z query parametra
$image = isset($_GET['image']) ? $_GET['image'] : '';
$directory = "images";
$imagePath = $directory . '/' . $image;

// Overiť, či obrázok existuje
if (!file_exists($imagePath)) {
    echo "Obrázok neexistuje.";
    exit();
}

$userAddress = $_SESSION['user_address'];

// Automatické obnovenie stránky pri prvom načítaní
if (!isset($_SESSION['editor_loaded'])) {
    $_SESSION['editor_loaded'] = true;
    header("Refresh: 0");
    exit();
}
?>

<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CHAINVERS - Orezávanie obrázka</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/cropperjs/dist/cropper.min.css">
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            background: linear-gradient(to bottom, #0a0a2a, #1a1a40);
            color: white;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        h1 {
            margin-top: 20px;
            color: #f5a623;
        }

        .image-container {
            margin: 20px 0;
        }

        .image-container img {
            max-width: 100%;
            height: auto;
            border-radius: 10px;
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
        }

        .btn-container {
            margin-top: 20px;
        }

        .btn {
            background-color: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            cursor: pointer;
            border-radius: 5px;
            font-size: 1rem;
            transition: background-color 0.3s;
            margin: 5px;
        }

        .btn:hover {
            background-color: #f5a623;
        }

        .preview-container {
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 20px;
            margin-top: 20px;
        }

        .preview-container canvas {
            max-width: 45%;
            border: 2px solid #f5a623;
            border-radius: 10px;
        }

        .table-container {
            margin-top: 20px;
            padding: 10px;
            background-color: #222;
            border-radius: 10px;
            color: white;
            font-size: 1rem;
        }

        .table-container table {
            width: 100%;
            border-collapse: collapse;
        }

        .table-container th, .table-container td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #444;
        }

        .table-container th {
            background-color: #444;
        }

        .table-container td {
            background-color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Orezávanie obrázka - CHAINVERS</h1>
        <p>Prihlásený používateľ: <strong><?= $userAddress ?></strong></p>

        <div class="image-container">
            <img id="imageToCrop" src="<?= $imagePath ?>" alt="Obrázok na orezanie">
        </div>

        <div class="btn-container">
            <button class="btn" id="rotateLeftButton">Rotovať doľava</button>
            <button class="btn" id="rotateRightButton">Rotovať doprava</button>
            <button class="btn" id="previewButton">ChainPreview</button>
            <button class="btn" id="buyButton">BuyChain</button>
        </div>

        <div id="previewContainer" class="preview-container"></div>

        <!-- Tabuľka pre údaje výrezu -->
        <div id="tableContainer" class="table-container">
            <h2>Tabuľka výrezu</h2>
            <table>
                <tr>
                    <th>X</th>
                    <th>Y</th>
                    <th>Width (W)</th>
                    <th>Height (H)</th>
                    <th>R (Rotácia)</th>
                </tr>
                <tr>
                    <td id="cropX">-</td>
                    <td id="cropY">-</td>
                    <td id="cropW">-</td>
                    <td id="cropH">-</td>
                    <td id="cropR">-</td>
                </tr>
            </table>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/cropperjs/dist/cropper.min.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const image = document.getElementById('imageToCrop');
            const rotateLeftButton = document.getElementById('rotateLeftButton');
            const rotateRightButton = document.getElementById('rotateRightButton');
            const previewButton = document.getElementById('previewButton');
            const buyButton = document.getElementById('buyButton');
            const previewContainer = document.getElementById('previewContainer');
            const tableContainer = document.getElementById('tableContainer');
            let cropper;

            // Inicializácia CropperJS
            image.addEventListener('load', function () {
                if (cropper) {
                    cropper.destroy(); // Ak už existuje, zrušíme predchádzajúci editor
                }
                cropper = new Cropper(image, {
                    aspectRatio: 1,
                    viewMode: 2,
                    autoCrop: true,
                    autoCropArea: 0.8,
                    scalable: true,
                    zoomable: true,
                    minCropBoxWidth: 200, // Minimálna šírka výrezu
                    minCropBoxHeight: 200, // Minimálna výška výrezu
                    ready() {
                        updateCropData();
                    },
                });
            });

            // Overiť, či je obrázok už načítaný
            if (image.complete) {
                image.dispatchEvent(new Event('load'));
            }

            // Rotácia obrázka
            rotateLeftButton.addEventListener('click', () => {
                if (cropper) {
                    cropper.rotate(-45);
                    updateCropData();
                }
            });

            rotateRightButton.addEventListener('click', () => {
                if (cropper) {
                    cropper.rotate(45);
                    updateCropData();
                }
            });

            // Funkcia na aktualizáciu údajov v tabuľke
            function updateCropData() {
                if (cropper) {
                    const data = cropper.getData();
                    const x = (data.x * 9) / 8;  // Zmenšenie výrezu na 8/9
                    const y = data.y;
                    const width = (data.width * 9) / 8;  // Zmenšenie výrezu na 8/9
                    const height = data.height;
                    const rotation = data.rotate;

                    // Aktualizácia tabuľky
                    document.getElementById('cropX').textContent = x.toFixed(2);
                    document.getElementById('cropY').textContent = y.toFixed(2);
                    document.getElementById('cropW').textContent = width.toFixed(2);
                    document.getElementById('cropH').textContent = height.toFixed(2);
                    document.getElementById('cropR').textContent = rotation.toFixed(2);
                }
            }

            // Funkcia na vytvorenie výrezov
            function createPreviews() {
                if (!cropper) {
                    alert("Editor sa nenačítal správne. Skúste obnoviť stránku.");
                    return;
                }

                previewContainer.innerHTML = ''; // Vyčistiť staré náhľady

                // Normálny výrez
                const croppedCanvas = cropper.getCroppedCanvas();
                const normalPreview = document.createElement('canvas');
                normalPreview.width = croppedCanvas.width;
                normalPreview.height = croppedCanvas.height;
                normalPreview.getContext('2d').drawImage(croppedCanvas, 0, 0);
                previewContainer.appendChild(normalPreview);

                // Inverzný výrez (s tabuľkou na mieste vyrezanej oblasti)
                const invertedCanvas = document.createElement('canvas');
                invertedCanvas.width = image.naturalWidth;
                invertedCanvas.height = image.naturalHeight;
                const ctx = invertedCanvas.getContext('2d');

                // Vykreslenie pôvodného obrázka
                ctx.drawImage(image, 0, 0);

                // Prekrytie vyrezanej oblasti s tabuľkou
                const cropBoxData = cropper.getData();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.fillRect(cropBoxData.x, cropBoxData.y, cropBoxData.width, cropBoxData.height);

                // Pridanie tabuľky na miesto vyrezanej oblasti
                const tableWidth = cropBoxData.width;
                const tableHeight = cropBoxData.height;
                const tableX = cropBoxData.x;
                const tableY = cropBoxData.y;

                // Definícia tabuľky na mieste vyrezanej oblasti
                ctx.fillStyle = '#f5a623'; // Farba tabuľky
                ctx.fillRect(tableX, tableY, tableWidth, tableHeight); // Tabuľka ako obdĺžnik

                // Prípadne môžeš pridať text do tabuľky
                ctx.fillStyle = 'black';
                ctx.font = '16px Arial';
                ctx.fillText("Tabuľka", tableX + 10, tableY + 20); // Text v tabuľke

                previewContainer.appendChild(invertedCanvas);
            }

            // ChainPreview: Zobraziť výrezy
            previewButton.addEventListener('click', createPreviews);

            // BuyChain: Simulácia uloženia a presmerovanie
            buyButton.addEventListener('click', () => {
                alert('Výrezy boli uložené. Pokračujeme na platobnú bránu...');
                // Sem pridajte kód na spracovanie uloženia a presmerovanie
            });
        });
    </script>
</body>
</html>