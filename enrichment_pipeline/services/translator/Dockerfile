# Build context is the enrichment_pipeline/ root (see docker-compose.yml).
#
# NOTE ON IMAGE SIZE / FIRST-RUN TIME: this service pulls in PyTorch and
# (on its very first real translation) downloads the ~1B-parameter
# IndicTrans2 indic-en checkpoint from HuggingFace, which is several GB.
# The base image build itself is CPU-only PyTorch to keep it as small as
# reasonably possible -- see README.md's "Design decisions" section for
# how to disable translation entirely (TRANSLATION_ENABLED=false) if you
# don't have the bandwidth/RAM for this in your environment.
FROM python:3.12-slim

WORKDIR /app

# CPU-only PyTorch build -- far smaller than the default CUDA wheels and
# all that's needed since this pipeline doesn't assume a GPU host.
RUN pip install --no-cache-dir torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu

COPY services/translator/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY services/translator/language.py ./language.py
COPY services/translator/pdf_text.py ./pdf_text.py
COPY services/translator/indictrans.py ./indictrans.py
COPY services/translator/main.py ./main.py

CMD ["python", "main.py"]
