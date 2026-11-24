from __future__ import annotations

import asyncio
import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

PLUGIN_DIR = Path(__file__).resolve().parents[1]


def _sibling(name: str):
    module_name = f"hermes_knowledge_base_{name}"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, PLUGIN_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


auth = _sibling("auth")
convex_client = _sibling("convex_client")
file_rules = _sibling("file_rules")
pdf_parts = _sibling("pdf_parts")
selection = _sibling("selection")

router = APIRouter()

NOT_CONFIGURED = "kb_not_configured"
SESSION_REQUIRED = "kb_session_required"
SESSION_INVALID = "kb_session_invalid"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_STATUS_MAP = {401: 428, 403: 422}

_transport: httpx.AsyncBaseTransport | None = None


class SessionCredentials(BaseModel):
    sessionId: str = Field(min_length=1, max_length=128)
    clientToken: str = Field(min_length=1, max_length=auth.MAX_TOKEN_LENGTH)
    frontendApi: str = Field(min_length=1, max_length=512)
    organizationId: str | None = Field(default=None, max_length=128)


class SessionBody(BaseModel):
    # Unitalk Desktop sends `credentials` (the plugin then mints its own fresh tokens from Clerk);
    # a client that cannot share them (the browser Webapp) keeps pushing a bare `token`.
    token: str | None = Field(default=None, min_length=1, max_length=auth.MAX_TOKEN_LENGTH)
    credentials: SessionCredentials | None = None


class ActiveBasesBody(BaseModel):
    baseIds: list[str] | None = Field(default=None, max_length=selection.MAX_ACTIVE_BASES)


class CreateBaseBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class UpdateBaseBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class RemoveFilesBody(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


class SearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    baseIds: list[str] | None = Field(default=None, max_length=100)
    limit: int | None = Field(default=None, ge=1, le=20)


def _check_id(value: str) -> str:
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise HTTPException(status_code=400, detail="invalid_id")
    return value


def _has_auth() -> bool:
    """Cheap check, no network: desktop credentials mint their token per request, off the event loop."""
    if auth.api_key():
        return True
    mode = auth.session_mode()
    if mode == "credentials":
        return True
    return mode == "token" and auth.session_token() is not None


def _client():
    site = auth.site_url()
    if not site:
        raise HTTPException(status_code=428, detail=NOT_CONFIGURED)
    if not _has_auth():
        raise HTTPException(status_code=428, detail=SESSION_REQUIRED)
    return convex_client.ConvexClient(site, auth.auth_headers, transport=_transport)


def _upstream_error(error) -> HTTPException:
    if error.status_code == 401:
        return HTTPException(status_code=428, detail=SESSION_INVALID)
    status = _STATUS_MAP.get(error.status_code, error.status_code)
    if status < 400 or status > 599:
        status = 502
    return HTTPException(status_code=status, detail=error.code)


async def _call(awaitable):
    try:
        return await awaitable
    except convex_client.ConvexError as error:
        raise _upstream_error(error) from None


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


@router.get("/config")
async def config() -> dict[str, Any]:
    has_session = await asyncio.to_thread(lambda: auth.auth_headers() is not None)
    return {"configured": auth.configured(), "session": has_session, "sessionMode": auth.session_mode()}


@router.put("/session")
async def put_session(body: SessionBody) -> dict[str, Any]:
    if body.credentials is not None:
        creds = body.credentials
        try:
            expires_at = await asyncio.to_thread(
                auth.store_credentials,
                creds.sessionId,
                creds.clientToken,
                creds.frontendApi,
                creds.organizationId,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error) or "invalid_credentials") from None
        except auth.SessionEnded:
            raise HTTPException(status_code=428, detail=SESSION_INVALID) from None
        except auth.OrganizationUnavailable:
            raise HTTPException(status_code=403, detail="kb_organization_unavailable") from None
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="clerk_unreachable") from None
        return {"ok": True, "expiresAt": expires_at, "mode": "credentials"}
    if not body.token:
        raise HTTPException(status_code=400, detail="invalid_session_token")
    try:
        expires_at = auth.store_session(body.token)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_session_token") from None
    return {"ok": True, "expiresAt": expires_at, "mode": "token"}


@router.get("/active-bases")
async def get_active_bases() -> dict[str, Any]:
    return {"baseIds": selection.active_base_ids(auth.current_scope())}


@router.put("/active-bases")
async def put_active_bases(body: ActiveBasesBody) -> dict[str, Any]:
    try:
        return {"baseIds": selection.set_active_base_ids(auth.current_scope(), body.baseIds)}
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_base_ids") from None


@router.delete("/session")
async def delete_session() -> dict[str, Any]:
    auth.clear_session()
    return {"ok": True}


@router.get("/bases")
async def list_bases() -> dict[str, Any]:
    result = await _call(_client().request("GET", "/kb/bases"))
    owned = result.get("owned") if isinstance(result, dict) else None
    shared = result.get("shared") if isinstance(result, dict) else None
    return {"owned": owned if isinstance(owned, list) else [], "shared": shared if isinstance(shared, list) else []}


@router.post("/bases")
async def create_base(body: CreateBaseBody) -> dict[str, Any]:
    name = _clean(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="invalid")
    payload: dict[str, Any] = {"name": name}
    description = _clean(body.description)
    if description:
        payload["description"] = description
    result = await _call(_client().request("POST", "/kb/bases", json=payload))
    return {"id": result.get("id") if isinstance(result, dict) else None}


@router.patch("/bases/{base_id}")
async def update_base(base_id: str, body: UpdateBaseBody) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": _check_id(base_id)}
    if body.name is not None:
        name = _clean(body.name)
        if not name:
            raise HTTPException(status_code=400, detail="invalid")
        payload["name"] = name
    if body.description is not None:
        payload["description"] = body.description.strip()
    await _call(_client().request("POST", "/kb/bases/update", json=payload))
    return {"ok": True}


@router.delete("/bases/{base_id}")
async def delete_base(base_id: str) -> dict[str, Any]:
    payload = {"id": _check_id(base_id)}
    await _call(_client().request("POST", "/kb/bases/delete", json=payload))
    return {"ok": True}


@router.get("/bases/{base_id}/files")
async def list_files(base_id: str) -> dict[str, Any]:
    params = {"baseId": _check_id(base_id)}
    result = await _call(_client().request("GET", "/kb/files", params=params))
    files = result.get("files") if isinstance(result, dict) else None
    return {"files": files if isinstance(files, list) else []}


async def _discard(client, file_id: str) -> None:
    try:
        await client.request("POST", "/kb/files/delete", json={"ids": [file_id]})
    except convex_client.ConvexError:
        pass


async def _upload(client, base_id: str, name: str, content_type: str, data: bytes) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "baseId": base_id,
        "name": name,
        "contentType": content_type,
        "size": len(data),
        "sha256": file_rules.sha256_hex(data),
    }
    layout = pdf_parts.PdfLayout(None, [])
    if file_rules.is_pdf(name, content_type):
        layout = await asyncio.to_thread(pdf_parts.layout, data)
    if layout.page_count is not None:
        payload["pageCount"] = layout.page_count
    if layout.parts:
        payload["parts"] = [{"fromPage": part.from_page, "toPage": part.to_page} for part in layout.parts]

    try:
        created = await client.request("POST", "/kb/files", json=payload)
    except convex_client.ConvexError as error:
        if error.status_code == 409 and error.code == "duplicate":
            return {"duplicate": True, "fileId": error.body.get("fileId")}
        raise

    file_id = created.get("fileId") if isinstance(created, dict) else None
    upload = created.get("upload") if isinstance(created, dict) else None
    part_uploads = created.get("partUploads") if isinstance(created, dict) else None
    part_uploads = [item for item in part_uploads if isinstance(item, dict)] if isinstance(part_uploads, list) else []
    if not isinstance(file_id, str) or not file_id:
        raise convex_client.ConvexError(502, "upstream", "Knowledge base service returned no file id")
    if not isinstance(upload, dict) or len(part_uploads) < len(layout.parts):
        await _discard(client, file_id)
        raise convex_client.ConvexError(502, "upstream", "Knowledge base service returned too few upload targets")

    try:
        await client.upload_object(upload, data, content_type)
        for part, target in zip(layout.parts, part_uploads):
            await client.upload_object(target, part.data, file_rules.PDF_CONTENT_TYPE)
    except convex_client.ConvexError:
        await _discard(client, file_id)
        raise

    try:
        await client.request("POST", "/kb/files/complete", json={"fileId": file_id})
    except convex_client.ConvexError:
        await _discard(client, file_id)
        raise
    return {"duplicate": False, "fileId": file_id, "parts": len(layout.parts)}


@router.post("/bases/{base_id}/files")
async def upload_file(base_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    _check_id(base_id)
    client = _client()
    name = (file.filename or "").replace("\\", "/").split("/")[-1].strip() or "file"
    content_type = file_rules.content_type_for(name, file.content_type)
    limit = file_rules.max_bytes(name, content_type)
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="too_large")
    if not data:
        raise HTTPException(status_code=400, detail="empty_file")
    return await _call(_upload(client, base_id, name, content_type, data))


@router.post("/files/{file_id}/retry")
async def retry_file(file_id: str) -> dict[str, Any]:
    payload = {"fileId": _check_id(file_id)}
    await _call(_client().request("POST", "/kb/files/retry", json=payload))
    return {"ok": True}


@router.post("/files/remove")
async def remove_files(body: RemoveFilesBody) -> dict[str, Any]:
    payload = {"ids": [_check_id(file_id) for file_id in body.ids]}
    await _call(_client().request("POST", "/kb/files/delete", json=payload))
    return {"ok": True}


@router.get("/files/{file_id}/download")
async def download_file(file_id: str) -> dict[str, Any]:
    params = {"fileId": _check_id(file_id)}
    result = await _call(_client().request("GET", "/kb/files/download", params=params))
    url = result.get("url") if isinstance(result, dict) else None
    if not isinstance(url, str) or not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=502, detail="upstream")
    return {"url": url}


@router.post("/search")
async def search(body: SearchBody) -> dict[str, Any]:
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="invalid")
    payload: dict[str, Any] = {"query": query}
    if body.baseIds:
        payload["baseIds"] = [_check_id(base_id) for base_id in body.baseIds]
    if body.limit is not None:
        payload["limit"] = body.limit
    result = await _call(_client().request("POST", "/kb/search", json=payload))
    chunks = result.get("chunks") if isinstance(result, dict) else None
    return {"chunks": chunks if isinstance(chunks, list) else []}
