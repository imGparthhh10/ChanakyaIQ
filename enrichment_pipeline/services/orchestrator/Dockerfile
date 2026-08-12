# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

COPY services/orchestrator/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/orchestrator/monitor.py ./monitor.py
COPY services/orchestrator/main.py ./main.py

EXPOSE 8080
CMD ["python", "main.py"]
