"""Content-addressed document repository on local disk. The checksum *is* the address — saving
the same bytes twice is naturally idempotent (same path, second write is a no-op), which is
what lets the collection engine skip re-persisting unchanged documents for free.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

_CONTENT_TYPE_TO_EXT = {
    "text/html": "html",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/json": "json",
    "image/jpeg": "jpg",
    "image/png": "png",
}


def sha256_checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def infer_file_format(content_type: str | None, url: str) -> str:
    if content_type:
        mime = content_type.split(";")[0].strip().lower()
        if mime in _CONTENT_TYPE_TO_EXT:
            return _CONTENT_TYPE_TO_EXT[mime]
    suffix = Path(url.split("?")[0]).suffix.lstrip(".").lower()
    return suffix if suffix and len(suffix) <= 5 else "bin"


def storage_path_for(storage_root: Path, checksum: str, file_format: str) -> Path:
    # Fan out by checksum prefix so one org's documents don't all land in a single flat
    # directory — a cheap, standard content-addressed-storage layout.
    return storage_root / checksum[:2] / checksum[2:4] / f"{checksum}.{file_format}"


def save_content(storage_root: Path, content: bytes, *, content_type: str | None, url: str) -> tuple[str, Path]:
    """Returns (checksum, absolute storage path). Writing the same content again is a cheap
    no-op — same checksum, same path, file already exists."""
    checksum = sha256_checksum(content)
    file_format = infer_file_format(content_type, url)
    path = storage_path_for(storage_root, checksum, file_format)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return checksum, path
