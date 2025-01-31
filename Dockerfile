# Používame oficiálny PHP obraz ako základ
FROM php:7.4-apache

# Kopírujeme všetky súbory z projektu do Docker kontajnera
COPY . /var/www/html/

# Nastavíme Apache, aby používal PHP
RUN docker-php-ext-install mysqli pdo pdo_mysql

# Exponujeme port 80 (štandardný port pre Apache)
EXPOSE 80

# Spustíme Apache server
CMD ["apache2-foreground"]