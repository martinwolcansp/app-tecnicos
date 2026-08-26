# Imagen mínima para servir test_conectividad.html como sitio estático.
# A propósito NO usa Nixpacks/apt-get: nginx:alpine ya trae todo lo necesario,
# así que este build no necesita salir a internet por el puerto 80 (bloqueado
# en el firewall de la empresa) — solo baja la imagen base por HTTPS (443),
# igual que cualquier otra imagen de Docker Hub.
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
