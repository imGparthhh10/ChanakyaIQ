"""Regional Indian language -> English translation via IndicTrans2. Optional (`translate`
extra: torch + transformers + sentencepiece) -- these are large, heavy, GPU-friendly-but-not
-required dependencies, so this is the most likely stage-4 sub-step to be absent in a given
environment. Missing -> translation is skipped, source text passes through untranslated with
that fact logged, never silently mistranslated or dropped.

Model is loaded lazily and cached at module level so a batch run only pays the load cost once,
not once per document.
"""

from __future__ import annotations

from typing import Any

_MODEL_NAME = "ai4bharat/indictrans2-indic-en-1B"
# Values are untyped (Any) deliberately -- torch/transformers aren't a hard dependency, so their
# real types aren't available to mypy here regardless; the module-level `ignore_missing_imports`
# setting already covers the import itself.
_model_cache: dict[str, Any] = {}


def translate_to_english(text: str, source_language: str) -> str | None:
    if not text.strip():
        return None
    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError:
        return None

    try:
        if "tokenizer" not in _model_cache:
            _model_cache["tokenizer"] = AutoTokenizer.from_pretrained(_MODEL_NAME, trust_remote_code=True)
            _model_cache["model"] = AutoModelForSeq2SeqLM.from_pretrained(_MODEL_NAME, trust_remote_code=True)
        tokenizer = _model_cache["tokenizer"]
        model = _model_cache["model"]

        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=1024)
        with torch.no_grad():
            generated = model.generate(**inputs, max_length=1024)
        return str(tokenizer.batch_decode(generated, skip_special_tokens=True)[0])
    except Exception:  # noqa: BLE001 -- model/runtime failures degrade, never crash the pipeline
        return None
