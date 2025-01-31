<?php
session_start();
if (!isset($_SESSION['user_logged_in']) || $_SESSION['user_logged_in'] !== true) {
    header("Location: login.php");
    exit();
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - CHAINVERS</title>
</head>
<body>
    <h1>Vitajte, <?php echo $_SESSION['user_name']; ?>!</h1>
    <img src="<?php echo $_SESSION['user_photo']; ?>" alt="User Photo">
    <p>Adresa: <?php echo $_SESSION['user_address']; ?></p>
    <p>Prezývka: <?php echo $_SESSION['user_nickname']; ?></p>
    <a href="crop.php">Pokračovať v úprave obrázka</a>
    <a href="logout.php">Odhlásiť sa</a>
</body>
</html>