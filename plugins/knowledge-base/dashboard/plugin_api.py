from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from hermes_cli.config import get_env_value_prefer_dotenv

router = APIRouter()


def _env(name: str) -> str:
    return (get_env_value_prefer_dotenv(name) or "").strip()


def _configured() -> bool:
    return bool(_env("QDRANT_URL"))


def _not_implemented() -> HTTPException:
    return HTTPException(status_code=501, detail="Not implemented")


@router.get("/config")
async def config() -> dict[str, Any]:
    return {"configured": _configured()}


@router.get("/bases")
async def list_bases() -> dict[str, Any]:
    raise _not_implemented()


@router.post("/bases")
async def create_base() -> dict[str, Any]:
    raise _not_implemented()


@router.delete("/bases/{base_id}")
async def delete_base(base_id: str) -> dict[str, Any]:
    raise _not_implemented()


@router.get("/bases/{base_id}/files")
async def list_files(base_id: str) -> dict[str, Any]:
    raise _not_implemented()


@router.post("/bases/{base_id}/files")
async def upload_file(base_id: str) -> dict[str, Any]:
    raise _not_implemented()


@router.delete("/bases/{base_id}/files/{file_id}")
async def delete_file(base_id: str, file_id: str) -> dict[str, Any]:
    raise _not_implemented()


@router.post("/bases/{base_id}/search")
async def search(base_id: str) -> dict[str, Any]:
    raise _not_implemented()
