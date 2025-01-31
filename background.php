<?php
// background.php
header('Content-Type: text/html; charset=utf-8');
?>
<style>
    /* Základné štýly pre pozadie */
    body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background-color: black;
        position: relative;
    }

    /* Štýly pre hviezdy */
    .star {
        position: absolute;
        border-radius: 50%;
        background-color: white;
        animation: starAnimation 5s linear infinite;
    }

    @keyframes starAnimation {
        0% {
            transform: translateX(0) translateY(0);
        }
        100% {
            transform: translateX(var(--dx)) translateY(var(--dy));
        }
    }

    /* Pridanie ďalších efektov (explózie) */
    .explosion {
        position: absolute;
        border-radius: 50%;
        background-color: yellow;
        opacity: 0;
        animation: explosionAnimation 1s forwards;
    }

    @keyframes explosionAnimation {
        0% {
            transform: scale(0);
            opacity: 1;
        }
        100% {
            transform: scale(3);
            opacity: 0;
        }
    }

    /* Štýl pre mobilné zariadenia */
    @media (max-width: 600px) {
        .star {
            width: 2px;
            height: 2px;
        }

        .explosion {
            width: 50px;
            height: 50px;
        }
    }
</style>

<script>
    document.addEventListener('DOMContentLoaded', function () {
        var numStars = 100; // Počet hviezd
        var body = document.body;

        // Generovanie hviezd
        for (let i = 0; i < numStars; i++) {
            let star = document.createElement('div');
            star.classList.add('star');
            let size = Math.random() * 3 + 'px';
            star.style.width = size;
            star.style.height = size;
            star.style.left = Math.random() * window.innerWidth + 'px';
            star.style.top = Math.random() * window.innerHeight + 'px';

            // Randomizovať pohyb hviezd
            let dx = Math.random() * 100 - 50;
            let dy = Math.random() * 100 - 50;
            star.style.setProperty('--dx', dx + 'px');
            star.style.setProperty('--dy', dy + 'px');

            body.appendChild(star);
        }

        // Vytvoriť výbuch pri kliknutí
        body.addEventListener('click', function(e) {
            var explosion = document.createElement('div');
            explosion.classList.add('explosion');
            explosion.style.left = e.pageX - 25 + 'px';  // Centrovanie výbuchu
            explosion.style.top = e.pageY - 25 + 'px';  // Centrovanie výbuchu
            body.appendChild(explosion);

            // Odstrániť výbuch po animácii
            setTimeout(function () {
                explosion.remove();
            }, 1000);
        });
    });
</script>