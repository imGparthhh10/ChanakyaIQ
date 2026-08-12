# Build context is the enrichment_pipeline/ root (see docker-compose.yml)
# so this Dockerfile can COPY the shared/ package alongside the service.
FROM python:3.12-slim

WORKDIR /app

COPY services/seed_loader/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/seed_loader/main.py ./main.py

CMD ["python", "main.py"]
