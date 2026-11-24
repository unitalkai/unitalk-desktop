from __future__ import annotations

import asyncio
from typing import Any, Callable

import httpx

REQUEST_TIMEOUT_SECONDS = 60.0
UPLOAD_TIMEOUT = httpx.Timeout(900.0, connect=30.0)


class ConvexError(Exception):
    def __init__(self, status_code: int, code: str, message: str = "", body: Any = None) -> None:
        super().__init__(message or code)
        self.status_code = status_code
        self.code = code
        self.message = message or code
        self.body = body if isinstance(body, dict) else {}


def _decode(response: httpx.Response) -> Any:
    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = None
    if response.is_success:
        if body is None:
            raise ConvexError(502, "upstream", "Knowledge base service returned invalid JSON")
        return body
    error = body if isinstance(body, dict) else {}
    code = error.get("code") if isinstance(error.get("code"), str) and error.get("code") else "upstream"
    message = error.get("error") if isinstance(error.get("error"), str) else ""
    raise ConvexError(response.status_code, code, message, error)


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
            raise ConvexError(401, "unauthorized", "No Unitalk session is connected")
        return dict(current)

    def _url(self, path: str) -> str:
        return f"{self.site_url}{path}"

    async def request(
        self, method: str, path: str, *, json: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        # Reading the headers may mint a fresh Clerk token over the network: keep it off the event loop.
        headers = await asyncio.to_thread(lambda: self.headers)
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.request(
                    method, self._url(path), json=json, params=_clean_params(params), headers=headers
                )
        except httpx.HTTPError as error:
            raise ConvexError(502, "upstream", f"Knowledge base service unreachable ({type(error).__name__})") from None
        return _decode(response)

    def request_sync(
        self, method: str, path: str, *, json: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        try:
            with httpx.Client(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = client.request(
                    method, self._url(path), json=json, params=_clean_params(params), headers=self.headers
                )
        except httpx.HTTPError as error:
            raise ConvexError(502, "upstream", f"Knowledge base service unreachable ({type(error).__name__})") from None
        return _decode(response)

    async def upload_object(self, target: dict[str, Any], data: bytes, content_type: str) -> None:
        """Send bytes to a storage upload target returned by POST /kb/files ({method, url, headers})."""
        method = target.get("method") if isinstance(target.get("method"), str) else "PUT"
        url = target.get("url")
        extra = target.get("headers") if isinstance(target.get("headers"), dict) else {}
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise ConvexError(502, "upstream", "Knowledge base service returned no upload URL")
        headers = {"Content-Type": content_type}
        headers.update({str(key): str(value) for key, value in extra.items()})
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=UPLOAD_TIMEOUT) as client:
                response = await client.request(method, url, content=data, headers=headers)
        except httpx.HTTPError as error:
            raise ConvexError(502, "upload_failed", f"Storage upload failed ({type(error).__name__})") from None
        if not response.is_success:
            raise ConvexError(502, "upload_failed", f"Storage upload failed with status {response.status_code}")
