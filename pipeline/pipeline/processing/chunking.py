"""Splits cleaned text into overlapping chunks for document_chunks / LLM extraction.

token_count is a whitespace-word-count approximation (~= 0.75 tokens/word for English is the
usual rule of thumb; we store the word count itself, not a fake token estimate dressed up as
exact, to avoid depending on a tokenizer library just for this). Good enough for the chunk-size
budget; not claimed to be an exact model token count anywhere downstream.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    chunk_index: int
    text: str
    token_count: int


def _word_count(text: str) -> int:
    return len(text.split())


def chunk_text(text: str, *, target_tokens: int, overlap_tokens: int) -> list[Chunk]:
    words = text.split()
    if not words:
        return []

    chunks: list[Chunk] = []
    start = 0
    chunk_index = 0
    step = max(target_tokens - overlap_tokens, 1)
    while start < len(words):
        window = words[start : start + target_tokens]
        chunk_words = " ".join(window)
        chunks.append(Chunk(chunk_index=chunk_index, text=chunk_words, token_count=len(window)))
        chunk_index += 1
        if start + target_tokens >= len(words):
            break
        start += step
    return chunks
