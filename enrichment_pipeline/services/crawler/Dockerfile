# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
FROM python:3.12-slim

# System libraries needed to run headless Firefox (Camoufox is a
# stealth-patched Firefox build) on Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates fonts-liberation \
    libgtk-3-0 libx11-xcb1 libasound2 libdbus-glib-1-2 libxt6 libxrandr2 \
    libxcomposite1 libxdamage1 libxfixes3 libxi6 libnss3 libcups2 \
    libatk1.0-0 libatk-bridge2.0-0 libpangocairo-1.0-0 libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/crawler/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch Camoufox's patched Firefox binary at build time so the image
# is ready to crawl immediately -- no first-run download delay, and no
# runtime dependency on internet access just to bootstrap the browser.
RUN python -m camoufox fetch

COPY shared ./shared
COPY services/crawler/search.py ./search.py
COPY services/crawler/fetcher.py ./fetcher.py
COPY services/crawler/main.py ./main.py

CMD ["python", "main.py"]
