# Použitie PHP s Apache serverom
FROM php:8.2-apache

# Povolenie modulov na upload súborov a prácu s JSON
RUN docker-php-ext-install mysqli pdo pdo_mysql

# Povolenie mod_rewrite pre lepšie URL
RUN a2enmod rewrite

# Nastavenie pracovného adresára
WORKDIR /var/www/html

# Skopírovanie súborov projektu do kontajnera
COPY . /var/www/html

# Povolenie oprávnení pre upload súborov
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

# Otvorenie portu 80
EXPOSE 80

# Spustenie Apache servera
CMD ["apache2-foreground"]
