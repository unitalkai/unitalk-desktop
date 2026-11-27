from __future__ import annotations

import hashlib
import mimetypes
import re

PDF_MAX_BYTES = 200 * 1024 * 1024
OTHER_MAX_BYTES = 20 * 1024 * 1024
PDF_CONTENT_TYPE = "application/pdf"
DEFAULT_CONTENT_TYPE = "application/octet-stream"

_EXTENSION_TYPES = {
    "md": "text/markdown",
    "markdown": "text/markdown",
    "txt": "text/plain",
    "csv": "text/csv",
    "json": "application/json",
    "jsonl": "application/jsonl",
    "ndjson": "application/x-ndjson",
    "pdf": PDF_CONTENT_TYPE,
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def file_extension(name: str) -> str:
    parts = name.split(".")
    if len(parts) < 2:
        return ""
    return re.sub(r"[^a-z0-9]", "", parts[-1].lower())


def content_type_for(name: str, declared: str | None) -> str:
    value = (declared or "").split(";")[0].strip().lower()
    if value and value != DEFAULT_CONTENT_TYPE:
        return value
    known = _EXTENSION_TYPES.get(file_extension(name))
    if known:
        return known
    guessed, _ = mimetypes.guess_type(name)
    return guessed or DEFAULT_CONTENT_TYPE


def is_pdf(name: str, content_type: str) -> bool:
    return content_type == PDF_CONTENT_TYPE or file_extension(name) == "pdf"


def max_bytes(name: str, content_type: str) -> int:
    return PDF_MAX_BYTES if is_pdf(name, content_type) else OTHER_MAX_BYTES


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
