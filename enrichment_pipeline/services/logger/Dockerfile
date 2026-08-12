# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

COPY services/logger/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/logger/main.py ./main.py

CMD ["python", "main.py"]
