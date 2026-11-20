from __future__ import annotations

import io
import zipfile
from typing import Any

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_MEMBER_BYTES = 512 * 1024 * 1024


def analyze_zip(data: bytes, detect_parser: Any) -> tuple[Any, list[Any]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Please select a ZIP export archive or a Claude JSON manifest file.") from None

    with archive:
        file_names = archive.namelist()

        def read_text(name: str) -> str:
            match = next((f for f in file_names if f == name or f.endswith(name)), None)
            if not match:
                raise ValueError(f"File not found in ZIP archive: {name}")
            if archive.getinfo(match).file_size > MAX_MEMBER_BYTES:
                raise ValueError(f"File too large in ZIP archive: {name}")
            return archive.read(match).decode("utf-8")

        parser = detect_parser(file_names)
        if not parser:
            raise ValueError("Unsupported export archive format. Supported providers: ChatGPT, Claude, Grok.")

        parsed = parser.parse(read_text, file_names)
        if not parsed:
            raise ValueError("No valid conversations found in the export archive.")

        return parser, parsed
