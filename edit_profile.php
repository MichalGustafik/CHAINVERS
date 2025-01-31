<?php
session_start();
$ethAddress = $_SESSION['eth_address'] ?? null;

if (!$ethAddress) {
    die("Unauthorized access.");
}

$userDir = "chainuserdata/$ethAddress";
$profileData = json_decode(file_get_contents("$userDir/profile.json"), true);

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $nickname = $_POST['nickname'] ?? $profileData['nickname'];
    $address = $_POST['address'] ?? $profileData['address'];
    $profilePhoto = $_FILES['profile_photo'];

    // Uloženie aktualizovaných údajov
    $profileData['nickname'] = $nickname;
    $profileData['address'] = $address;

    if ($profilePhoto['error'] === UPLOAD_ERR_OK) {
        $ext = pathinfo($profilePhoto['name'], PATHINFO_EXTENSION);
        $targetFile = "$userDir/profile_photo.$ext";
        move_uploaded_file($profilePhoto['tmp_name'], $targetFile);
        $profileData['profile_photo'] = $targetFile;
    }

    file_put_contents("$userDir/profile.json", json_encode($profileData));
    echo "Profile updated!";
}
?>
<form method="post" enctype="multipart/form-data">
    <input type="text" name="nickname" value="<?= $profileData['nickname'] ?>" placeholder="Nickname">
    <textarea name="address" placeholder="Address"><?= $profileData['address'] ?></textarea>
    <input type="file" name="profile_photo" accept="image/*">
    <button type="submit">Update Profile</button>
</form>