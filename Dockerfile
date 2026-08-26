# Imagen mínima para servir tools/ping-ia-tester/index.html como sitio estático.
# Vive en la raíz del repo a propósito: evita depender de la combinación de
# "Base Directory" + "Dockerfile Location" para subcarpetas en Coolify, que en
# esta versión no está resolviendo bien esa ruta. No usa Nixpacks/apt-get:
# nginx:alpine ya trae todo lo necesario, así que este build no necesita salir
# a internet por el puerto 80 (bloqueado en el firewall de la empresa) — solo
# baja la imagen base por HTTPS (443), igual que cualquier otra imagen de
# Docker Hub.
FROM nginx:alpine
COPY tools/ping-ia-tester/index.html /usr/share/nginx/html/index.html
