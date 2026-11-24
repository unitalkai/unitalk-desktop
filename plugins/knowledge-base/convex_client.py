from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any, Callable

import httpx

REQUEST_TIMEOUT_SECONDS = 60.0
UPLOAD_TIMEOUT = httpx.Timeout(900.0, connect=30.0)
REQUEST_ID_HEADER = "x-kb-request-id"

# Failures are logged as one JSON line ("kb.error ...") naming the step that failed. Hermes writes
# the root logger to ~/.hermes/logs/agent.log, warnings also to errors.log. The request id is sent
# to Convex, which logs the same id with its own step (e.g. embed, qdrant_search).
logger = logging.getLogger("plugins.knowledge_base")

# Steps on the Hermes side; Convex reports its own pipeline steps in the error body.
STEP_CLERK_MINT = "clerk_mint"
STEP_CONVEX_REQUEST = "convex_request"
STEP_BLOB_UPLOAD = "blob_upload"


def new_request_id() -> str:
    return f"hermes_{secrets.token_hex(8)}"


class ConvexError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str = "",
        body: Any = None,
        *,
        step: str | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message or code)
        self.status_code = status_code
        self.code = code
        self.message = message or code
        self.body = body if isinstance(body, dict) else {}
        upstream_step = self.body.get("step")
        self.step = upstream_step if isinstance(upstream_step, str) and upstream_step else step
        service = self.body.get("service")
        self.service = service if isinstance(service, str) and service else None
        upstream_id = self.body.get("requestId")
        self.request_id = upstream_id if isinstance(upstream_id, str) and upstream_id else request_id

    def trace(self) -> dict[str, Any]:
        """The fields that locate this failure (no secrets): safe to log and to return."""
        return {
            key: value
            for key, value in (("step", self.step), ("service", self.service), ("requestId", self.request_id))
            if value
        }


def log_failure(error: ConvexError, route: str, started: float | None = None) -> None:
    fields: dict[str, Any] = {
        "evt": "kb.error",
        "route": route,
        "status": error.status_code,
        "code": error.code,
        **error.trace(),
        "message": error.message[:300],
    }
    if started is not None:
        fields["ms"] = int((time.monotonic() - started) * 1000)
    # Expected answers (duplicate upload, missing item, rejected input) stay out of errors.log.
    expected = 400 <= error.status_code < 500 and error.status_code not in (401, 403)
    logger.log(logging.INFO if expected else logging.WARNING, "kb.error %s", json.dumps(fields))


def _decode(response: httpx.Response, request_id: str | None = None) -> Any:
    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = None
    request_id = response.headers.get(REQUEST_ID_HEADER) or request_id
    if response.is_success:
        if body is None:
            raise ConvexError(
                502,
                "upstream",
                "Knowledge base service returned invalid JSON",
                step=STEP_CONVEX_REQUEST,
                request_id=request_id,
            )
        return body
    error = body if isinstance(body, dict) else {}
    code = error.get("code") if isinstance(error.get("code"), str) and error.get("code") else "upstream"
    message = error.get("error") if isinstance(error.get("error"), str) else ""
    raise ConvexError(
        response.status_code, code, message, error, step=STEP_CONVEX_REQUEST, request_id=request_id
    )


def _clean_params(params: dict[str, Any] | None) -> dict[str, Any] | None:
    if not params:
        return None
    return {key: value for key, value in params.items() if value is not None}


class ConvexClient:
    def __init__(
        self,
        site_url: str,
        headers: dict[str, str] | Callable[[], dict[str, str] | None],
        transport: httpx.AsyncBaseTransport | httpx.BaseTransport | None = None,
    ) -> None:
        self.site_url = site_url.rstrip("/")
        # A callable is re-read on every request: session tokens live about a minute (the plugin mints
        # fresh ones from Clerk), so a long upload must not finish with the token it started with.
        self._headers = headers if callable(headers) else dict(headers)
        self.transport = transport

    @property
    def headers(self) -> dict[str, str]:
        current = self._headers() if callable(self._headers) else self._headers
        if current is None:
            # No usable token: Clerk refused or could not mint one (auth logs the reason).
            raise ConvexError(401, "unauthorized", "No Unitalk session is connected", step=STEP_CLERK_MINT)
        return dict(current)

    def _url(self, path: str) -> str:
        return f"{self.site_url}{path}"

    @staticmethod
    def _unreachable(error: httpx.HTTPError, request_id: str) -> ConvexError:
        return ConvexError(
            502,
            "upstream",
            f"Knowledge base service unreachable ({type(error).__name__})",
            step=STEP_CONVEX_REQUEST,
            request_id=request_id,
        )

    async def request(
        self, method: str, path: str, *, json: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        request_id, started, route = new_request_id(), time.monotonic(), f"{method} {path}"
        try:
            # Reading the headers may mint a fresh Clerk token over the network: keep it off the event loop.
            headers = {**await asyncio.to_thread(lambda: self.headers), REQUEST_ID_HEADER: request_id}
            try:
                async with httpx.AsyncClient(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS) as client:
                    response = await client.request(
                        method, self._url(path), json=json, params=_clean_params(params), headers=headers
                    )
            except httpx.HTTPError as error:
                raise self._unreachable(error, request_id) from None
            return _decode(response, request_id)
        except ConvexError as error:
            error.request_id = error.request_id or request_id
            log_failure(error, route, started)
            raise

    def request_sync(
        self, method: str, path: str, *, json: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        request_id, started, route = new_request_id(), time.monotonic(), f"{method} {path}"
        try:
            headers = {**self.headers, REQUEST_ID_HEADER: request_id}
            try:
                with httpx.Client(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS) as client:
                    response = client.request(
                        method, self._url(path), json=json, params=_clean_params(params), headers=headers
                    )
            except httpx.HTTPError as error:
                raise self._unreachable(error, request_id) from None
            return _decode(response, request_id)
        except ConvexError as error:
            error.request_id = error.request_id or request_id
            log_failure(error, route, started)
            raise

    async def upload_object(self, target: dict[str, Any], data: bytes, content_type: str) -> None:
        """Send bytes to a storage upload target returned by POST /kb/files ({method, url, headers})."""
        method = target.get("method") if isinstance(target.get("method"), str) else "PUT"
        url = target.get("url")
        extra = target.get("headers") if isinstance(target.get("headers"), dict) else {}
        started = time.monotonic()
        try:
            if not isinstance(url, str) or not url.startswith(("https://", "http://")):
                raise ConvexError(
                    502, "upstream", "Knowledge base service returned no upload URL", step=STEP_BLOB_UPLOAD
                )
            headers = {"Content-Type": content_type}
            headers.update({str(key): str(value) for key, value in extra.items()})
            try:
                async with httpx.AsyncClient(transport=self.transport, timeout=UPLOAD_TIMEOUT) as client:
                    response = await client.request(method, url, content=data, headers=headers)
            except httpx.HTTPError as error:
                raise ConvexError(
                    502, "upload_failed", f"Storage upload failed ({type(error).__name__})", step=STEP_BLOB_UPLOAD
                ) from None
            if not response.is_success:
                raise ConvexError(
                    502,
                    "upload_failed",
                    f"Storage upload failed with status {response.status_code}",
                    step=STEP_BLOB_UPLOAD,
                )
        except ConvexError as error:
            # The URL holds a short-lived upload token: log the step and size only, never the URL.
            log_failure(error, f"{method} blob ({len(data)} bytes)", started)
            raise
