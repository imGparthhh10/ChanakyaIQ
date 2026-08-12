"""IndicTrans2 (AI4Bharat) indic-to-English translation.

Loads `ai4bharat/indictrans2-indic-en-1B` from HuggingFace lazily -- on
first real translation need, not at container startup -- so a run whose
content is entirely already-English (very common for BSE/NSE/RBI filings)
never pays the multi-GB download / load cost at all.

If the model fails to load (no internet on first run, insufficient RAM,
etc.) translation is disabled for the rest of the container's life and
every document is passed through untranslated with a clear warning
logged -- this is a degraded mode, not a crash, matching the "one bad
job/stage must never take down the pipeline" requirement at the
model-loading level too.
"""
from __future__ import annotations

import logging
import re
import threading

log = logging.getLogger("translator.indictrans")

MODEL_NAME = "ai4bharat/indictrans2-indic-en-1B"
TARGET_LANG = "eng_Latn"
MAX_CHARS_PER_CHUNK = 400
BATCH_SIZE = 8
MAX_CHARS_PER_DOCUMENT = 40_000  # bounds worst-case translation time on a huge report

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.?!।])\s+")  # । = Devanagari danda


def split_into_chunks(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    sentences = _SENTENCE_SPLIT_RE.split(text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        if len(current) + len(sentence) + 1 <= max_chars:
            current = f"{current} {sentence}".strip()
        else:
            if current:
                chunks.append(current)
            if len(sentence) > max_chars:
                # A single sentence longer than the cap: hard-split it.
                for i in range(0, len(sentence), max_chars):
                    chunks.append(sentence[i : i + max_chars])
                current = ""
            else:
                current = sentence
    if current:
        chunks.append(current)
    return chunks


class IndicTrans2Translator:
    """Process-wide singleton -- construct once, reuse for every job."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tokenizer = None
        self._model = None
        self._processor = None
        self.available: bool = False
        self._load_attempted = False
        self.load_error: str | None = None

    def _ensure_loaded(self) -> None:
        if self._load_attempted:
            return
        with self._lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            try:
                import torch
                from IndicTransToolkit.processor import IndicProcessor
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

                log.info("loading %s (first use only, may take a while / download several GB)", MODEL_NAME)
                self._tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
                self._model = AutoModelForSeq2SeqLM.from_pretrained(
                    MODEL_NAME, trust_remote_code=True, torch_dtype=torch.float32
                )
                self._model.eval()
                self._processor = IndicProcessor(inference=True)
                self._torch = torch
                self.available = True
                log.info("%s loaded successfully", MODEL_NAME)
            except Exception as exc:  # noqa: BLE001 - degrade, don't crash the container
                self.load_error = str(exc)
                self.available = False
                log.error("failed to load %s -- translation disabled for this run: %s", MODEL_NAME, exc)

    def translate_batch(self, texts: list[str], src_lang_flores: str) -> list[str]:
        """Best-effort: on any failure, returns the input texts unchanged
        so the caller always gets a same-length list back."""
        if not texts:
            return []
        self._ensure_loaded()
        if not self.available:
            return list(texts)
        try:
            batch = self._processor.preprocess_batch(texts, src_lang=src_lang_flores, tgt_lang=TARGET_LANG)
            inputs = self._tokenizer(
                batch, truncation=True, padding="longest", return_tensors="pt", max_length=256
            )
            with self._torch.no_grad():
                generated = self._model.generate(
                    **inputs, max_length=256, num_beams=4, num_return_sequences=1, use_cache=True
                )
            decoded = self._tokenizer.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True)
            return self._processor.postprocess_batch(decoded, lang=TARGET_LANG)
        except Exception as exc:  # noqa: BLE001 - one failed batch must not lose the whole document
            log.warning("translation batch of %d chunk(s) failed, keeping original text for it: %s", len(texts), exc)
            return list(texts)

    def translate_document(self, text: str, src_lang_flores: str) -> str:
        text = (text or "")[:MAX_CHARS_PER_DOCUMENT]
        chunks = split_into_chunks(text)
        if not chunks:
            return text
        out: list[str] = []
        for i in range(0, len(chunks), BATCH_SIZE):
            out.extend(self.translate_batch(chunks[i : i + BATCH_SIZE], src_lang_flores))
        return " ".join(out)
