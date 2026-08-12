# Static frontend (plain HTML/CSS/JS, no build step -- ES modules loaded
# directly by the browser). nginx just serves the files as-is.

FROM nginx:1.27-alpine

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY assets /usr/share/nginx/html/assets
COPY data /usr/share/nginx/html/data

EXPOSE 80
