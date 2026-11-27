from __future__ import annotations

import io
from dataclasses import dataclass

PAGES_PER_PART = 100


@dataclass(frozen=True)
class PdfPart:
    from_page: int
    to_page: int
    data: bytes


@dataclass(frozen=True)
class PdfLayout:
    page_count: int | None
    parts: list[PdfPart]


def _pypdf():
    try:
        import pypdf
    except ImportError:
        return None
    return pypdf


def available() -> bool:
    return _pypdf() is not None


def part_ranges(page_count: int, size: int = PAGES_PER_PART) -> list[tuple[int, int]]:
    if page_count <= size:
        return []
    return [(start, min(start + size - 1, page_count)) for start in range(1, page_count + 1, size)]


def layout(data: bytes, size: int = PAGES_PER_PART) -> PdfLayout:
    pypdf = _pypdf()
    if pypdf is None:
        return PdfLayout(None, [])
    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
        page_count = len(reader.pages)
    except Exception:
        return PdfLayout(None, [])
    try:
        parts = []
        for start, end in part_ranges(page_count, size):
            writer = pypdf.PdfWriter()
            for index in range(start - 1, end):
                writer.add_page(reader.pages[index])
            buffer = io.BytesIO()
            writer.write(buffer)
            parts.append(PdfPart(start, end, buffer.getvalue()))
    except Exception:
        return PdfLayout(page_count, [])
    return PdfLayout(page_count, parts)
