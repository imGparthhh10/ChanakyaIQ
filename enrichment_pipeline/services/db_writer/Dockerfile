# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

COPY services/db_writer/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/db_writer/validators.py ./validators.py
COPY services/db_writer/db.py ./db.py
COPY services/db_writer/excel_writer.py ./excel_writer.py
COPY services/db_writer/main.py ./main.py

CMD ["python", "main.py"]
