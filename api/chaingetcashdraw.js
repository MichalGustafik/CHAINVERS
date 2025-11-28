<?php
session_start();
error_reporting(E_ALL);
ini_set('display_errors', 1);

/* ============================================================
   USER
   ============================================================ */
$user = $_SESSION['user_address'] ?? ($_GET['user'] ?? null);
if (!$user) die("No user provided.");

/* ============================================================
   GET ORDERS – čisto lokálne
   ============================================================ */
function get_orders_raw($user) {
    $file = __DIR__ . "/chainuserdata/$user/orders.json";

    if (!file_exists($file)) return [];
    $json = file_get_contents($file);
    $data = json_decode($json, true);

    if (!is_array($data)) return [$data];
    if (isset($data['orders'])) return $data['orders'];

    return $data;
}

/* ============================================================
   SAVE ORDERS – lokálne prepisovanie
   ============================================================ */
function save_orders($user, $orders) {
    $file = __DIR__ . "/chainuserdata/$user/orders.json";
    file_put_contents($file, json_encode($orders, JSON_PRETTY_PRINT));
}

/* ============================================================
   ENDPOINT: chaindraw.php?save=1&token=X&newgain=Y
   ============================================================ */
if (isset($_GET['save'])) {

    $tid     = intval($_GET['token']);
    $newgain = floatval($_GET['newgain']);

    $orders = get_orders_raw($user);

    foreach ($orders as &$o) {
        $oid = $o['token_id'] ?? $o['tokenId'];
        if (intval($oid) === $tid) {
            $o['contract_gain'] = $newgain;
        }
    }

    save_orders($user, $orders);
    echo "OK";
    exit;
}

/* ============================================================
   LOAD TOKENS FOR UI
   ============================================================ */
$orders = get_orders_raw($user);
$tokens = [];

foreach ($orders as $o) {
    $tid = $o['token_id'] ?? $o['tokenId'] ?? null;
    if (!$tid) continue;

    $gain = floatval($o['contract_gain'] ?? 0);
    if ($gain <= 0) continue;

    $tokens[] = [
        "tokenId" => intval($tid),
        "gain"    => $gain
    ];
}
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>CHAINVERS Withdraw</title>

<style>
body { background:#0c0c14; color:white; font-family:Arial; padding:20px; }
.box { background:#191919; padding:20px; border-radius:14px;
       border:1px solid #5a3bff; max-width:670px; margin:auto; }
.line { padding:18px 0; border-bottom:1px solid #2f2f2f; }
.btn { background:#7f5cff; border:0; padding:8px 12px;
       border-radius:6px; cursor:pointer; color:white; }
.value { margin-top:6px; font-size:14px; color:#8ef8d1; }
.success { background:#0fb172; padding:12px; border-radius:8px; margin-bottom:10px; }
.error { background:#b31a1a; padding:12px; border-radius:8px; margin-bottom:10px; }

/* Loading overlay */
#overlay {
  position:fixed;top:0;left:0;width:100%;height:100%;
  background:rgba(0,0,0,0.85);
  color:white;font-size:26px;
  display:none;align-items:center;
  justify-content:center;z-index:9999;
}
</style>
</head>
<body>

<div id="overlay">⏳ Prebieha transakcia…</div>

<h2>Withdraw – CHAINVERS</h2>
<p><b><?=htmlspecialchars($user)?></b></p>

<div id="msg"></div>

<div class="box">
<?php if (empty($tokens)): ?>
    Žiadne prostriedky na výber.
<?php else: ?>

<?php foreach ($tokens as $t):
    $tid  = $t['tokenId'];
    $gain = $t['gain'];
?>
<div class="line" id="token<?=$tid?>">
    <b>NFT #<?=$tid?></b><br>
    Zostatok: <b id="bal<?=$tid?>"><?=$gain?> ETH</b><br><br>

    Vybrať sumu:<br>

    <input
        type="range"
        min="0.0001"
        max="<?=$gain?>"
        step="0.00001"
        value="0.0001"
        id="slider<?=$tid?>"
        oninput="updateValue(<?=$tid?>, this.value)"
        style="width:100%;">
    
    <div class="value" id="val<?=$tid?>">0.0001 ETH</div>

    <button class="btn" onclick="withdrawAmount(<?=$tid?>)">Withdraw túto sumu</button>
</div>

<?php endforeach; ?>

<?php endif; ?>
</div>

<script>
const API = "https://chainvers.vercel.app/api/chaingetcashdraw";

function updateValue(id, v) {
    document.getElementById("val" + id).innerText = parseFloat(v).toFixed(6) + " ETH";
}

async function withdrawAmount(tokenId) {

    const slider = document.getElementById("slider" + tokenId);
    const amount = parseFloat(slider.value);
    const gain   = parseFloat(document.getElementById("bal" + tokenId).innerText);

    // SHOW LOADING
    document.getElementById("overlay").style.display = "flex";

    const url = `${API}?action=withdrawAmount&tokenId=${tokenId}&amount=${amount}&gain=${gain}&user=<?=$user?>`;

    const res  = await fetch(url);
    const json = await res.json();

    document.getElementById("overlay").style.display = "none";

    if (json.status !== "SUCCESS") {
        document.getElementById("msg").innerHTML =
            `<div class="error">❌ ${json.error}</div>`;
        return;
    }

    const remaining = json.remaining;

    if (remaining <= 0) {
        document.getElementById("token" + tokenId).remove();
    } else {
        document.getElementById("bal" + tokenId).innerText = remaining + " ETH";

        const sliderEl = document.getElementById("slider" + tokenId);
        sliderEl.max = remaining;
        sliderEl.value = Math.min(0.0001, remaining);

        updateValue(tokenId, sliderEl.value);
    }

    // SAVE orders.json locally (no antibot)
    await fetch(`chaindraw.php?save=1&user=<?=$user?>&token=${tokenId}&newgain=${remaining}`);

    document.getElementById("msg").innerHTML =
        `<div class="success">✅ Vybraté ${json.withdrawn} ETH z NFT #${tokenId}<br>TX: ${json.tx}</div>`;
}
</script>

</body>
</html>