# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

COPY services/icp_scorer/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/icp_scorer/rules.py ./rules.py
COPY services/icp_scorer/config ./config
COPY services/icp_scorer/main.py ./main.py

CMD ["python", "main.py"]
