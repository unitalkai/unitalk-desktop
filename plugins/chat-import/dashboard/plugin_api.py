from __future__ import annotations

import hashlib
import importlib.util
import sys
import threading
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from hermes_cli.config import get_env_value_prefer_dotenv

PLUGIN_DIR = Path(__file__).resolve().parents[1]
MAX_KEPT_UPLOADS = 5


def _sibling(name: str) -> Any:
    module_name = f"hermes_chat_import_{name}"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, PLUGIN_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


parsers = _sibling("parsers")
archive = _sibling("archive")
importer = _sibling("importer")
unitalk_source = _sibling("unitalk_source")

router = APIRouter()

_lock = threading.Lock()
_uploads: OrderedDict[str, dict[str, Any]] = OrderedDict()
_jobs: dict[str, dict[str, Any]] = {}


class ImportBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    upload_id: str = Field(alias="uploadId")
    ids: list[str] | None = None


def _open_db() -> Any:
    from hermes_state import SessionDB

    return SessionDB()


async def _read_upload(upload: UploadFile) -> bytes:
    data = await upload.read(archive.MAX_UPLOAD_BYTES + 1)
    if len(data) > archive.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Export file is larger than 25 MB")
    return data


def _basename(name: str) -> str:
    return name.lower().replace("\\", "/").rsplit("/", 1)[-1]


def _analyze(data: bytes) -> tuple[Any, list[Any]]:
    try:
        return archive.analyze_zip(data, parsers.detect_parser)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/preview")
async def preview(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    manifest_file = next((f for f in files if (f.filename or "").lower().endswith(".json")), None)
    zip_files = [f for f in files if (f.filename or "").lower().endswith(".zip") or f.content_type in (
        "application/zip", "application/x-zip-compressed")]

    if manifest_file:
        try:
            manifest = parsers.parse_claude_manifest((await _read_upload(manifest_file)).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        data_file = parsers.conversations_data_file(manifest)
        if not data_file:
            raise HTTPException(
                status_code=400, detail="This Claude manifest does not reference a conversations data file.")
        target = _basename(data_file["filename"])
        matching = next((f for f in zip_files if _basename(f.filename or "") == target), None)
        if not matching:
            raise HTTPException(status_code=409, detail={
                "error": "data_file_required",
                "filename": data_file["filename"],
                "exportUrl": data_file.get("export_url"),
            })
        data = await _read_upload(matching)
    elif zip_files:
        data = await _read_upload(zip_files[0])
    else:
        raise HTTPException(status_code=400, detail="Please select a ZIP export archive or a Claude JSON manifest file.")

    parser, conversations = _analyze(data)
    upload_id = hashlib.sha256(data).hexdigest()

    with _lock:
        _uploads[upload_id] = {"provider": parser.provider_id, "conversations": conversations}
        _uploads.move_to_end(upload_id)
        while len(_uploads) > MAX_KEPT_UPLOADS:
            _uploads.popitem(last=False)

    return {
        "uploadId": upload_id,
        "provider": parser.provider_id,
        "providerName": parser.provider_name,
        "conversations": [
            {"id": c.id, "title": c.title, "messages": len(c.messages)} for c in conversations
        ],
    }


def _run_job(job_id: str, conversations: list[Any]) -> None:
    job = _jobs[job_id]

    def on_progress(conversation_id: str) -> None:
        with _lock:
            job["completedIds"].append(conversation_id)

    try:
        db = _open_db()
        try:
            result = importer.import_conversations(db, conversations, on_progress=on_progress)
        finally:
            db.close()
        with _lock:
            job.update(
                status="completed",
                imported=result.imported,
                skipped=result.skipped,
                failed=result.failed,
            )
    except Exception as exc:
        with _lock:
            job.update(status="failed", error=str(exc))


@router.post("/import")
async def start_import(body: ImportBody) -> dict[str, Any]:
    with _lock:
        upload = _uploads.get(body.upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found, analyze the export again")

    conversations = upload["conversations"]
    if body.ids is not None:
        wanted = set(body.ids)
        conversations = [c for c in conversations if c.id in wanted]

    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "uploadId": body.upload_id,
            "provider": upload["provider"],
            "status": "importing",
            "total": len(conversations),
            "completedIds": [],
            "imported": [],
            "skipped": [],
            "failed": {},
            "error": None,
        }

    threading.Thread(target=_run_job, args=(job_id, conversations), daemon=True).start()
    return {"jobId": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str) -> dict[str, Any]:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return {**job, "completedIds": list(job["completedIds"])}


@router.post("/unitalk/sync")
async def unitalk_sync(x_unitalk_session: str | None = Header(default=None)) -> dict[str, Any]:
    token = (x_unitalk_session or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to Unitalk to sync your chats")

    convex_url = (get_env_value_prefer_dotenv("UNITALK_CONVEX_URL") or "").strip()
    if not convex_url:
        raise HTTPException(status_code=503, detail="UNITALK_CONVEX_URL is not configured")

    try:
        return await unitalk_source.sync_my_chats(convex_url, token)
    except unitalk_source.UnitalkSyncError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None
