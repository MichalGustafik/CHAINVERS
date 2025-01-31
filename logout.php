<?php
session_start();
session_unset();
session_destroy();

// Odstránenie cookies
setcookie('user_logged_in', '', time() - 3600, '/', '.chainvers.com');
setcookie('user_name', '', time() - 3600, '/', '.chainvers.com');
setcookie('user_photo', '', time() - 3600, '/', '.chainvers.com');

// Presmerovanie na login
header("Location: login.php");
exit();
?>