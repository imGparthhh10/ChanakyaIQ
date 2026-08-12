"""Text cleaning: header/footer removal, duplicate-block removal, whitespace/hyphenation
repair. Pure stdlib, no optional dependency -- always runs.
"""

from __future__ import annotations

import re

_MULTI_BLANK_RE = re.compile(r"\n{3,}")
_TRAILING_SPACE_RE = re.compile(r"[ \t]+\n")
_HYPHENATED_LINEBREAK_RE = re.compile(r"(\w)-\n(\w)")
_MIN_LINE_LEN_TO_CONSIDER_HEADER_FOOTER = 3
_HEADER_FOOTER_REPEAT_THRESHOLD = 3  # a line seen this many+ times across the doc is boilerplate


def _repair_hyphenation(text: str) -> str:
    # "informa-\ntion" -> "information" (word split across a line break by a hyphen)
    return _HYPHENATED_LINEBREAK_RE.sub(r"\1\2", text)


def _remove_repeated_boilerplate(text: str) -> str:
    """Lines that repeat many times across a long document (page headers/footers, "Page X of
    Y", watermark text) are removed; everything else is kept, in original order."""
    lines = text.split("\n")
    if len(lines) < 20:  # too short for header/footer repetition to be a meaningful signal
        return text
    counts: dict[str, int] = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) >= _MIN_LINE_LEN_TO_CONSIDER_HEADER_FOOTER:
            counts[stripped] = counts.get(stripped, 0) + 1
    boilerplate = {line for line, count in counts.items() if count >= _HEADER_FOOTER_REPEAT_THRESHOLD}
    return "\n".join(line for line in lines if line.strip() not in boilerplate)


def _dedupe_consecutive_blocks(text: str) -> str:
    paragraphs = text.split("\n\n")
    out: list[str] = []
    last: str | None = None
    for p in paragraphs:
        if p.strip() and p.strip() == last:
            continue
        out.append(p)
        last = p.strip()
    return "\n\n".join(out)


def clean_text(raw_text: str) -> str:
    text = _repair_hyphenation(raw_text)
    text = _remove_repeated_boilerplate(text)
    text = _dedupe_consecutive_blocks(text)
    text = _TRAILING_SPACE_RE.sub("\n", text)
    text = _MULTI_BLANK_RE.sub("\n\n", text)
    return text.strip()
