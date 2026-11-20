from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()


def _not_implemented() -> HTTPException:
    return HTTPException(status_code=501, detail="Not implemented")


@router.post("/preview")
async def preview() -> dict[str, Any]:
    raise _not_implemented()


@router.post("/import")
async def start_import() -> dict[str, Any]:
    raise _not_implemented()


@router.get("/jobs/{job_id}")
async def job_status(job_id: str) -> dict[str, Any]:
    raise _not_implemented()
