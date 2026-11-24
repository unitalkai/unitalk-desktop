"""How the plugin authenticates to the Convex knowledge-base routes.

In order of preference:

1. A gateway key (``LITELLM_KEY_ID`` / ``UNITALK_API_KEY``), sent as ``x-litellm-key``. Cloud Hermes
   containers have one; it never expires.
2. Clerk session credentials pushed once by Unitalk Desktop (session id + the native client token
   ``@clerk/electron`` keeps). Before a Convex call the plugin mints a fresh ~60 s session JWT from
   Clerk's Frontend API, so access lasts as long as the Clerk session itself, also while the app is
   idle or closed. Signing out (or revoking the session in Clerk) ends it.
3. A bare Clerk session JWT pushed by a client that cannot share credentials (the browser-hosted
   Webapp). It lasts until the JWT expires, so that client keeps pushing.

Credentials and tokens live in the plugin's data dir (``session.json``, mode 0600).
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

PLUGIN_NAME = "knowledge-base"
SITE_URL_ENV = "KB_CONVEX_SITE_URL"
KEY_ENVS = ("LITELLM_KEY_ID", "UNITALK_API_KEY")
KEY_HEADER = "x-litellm-key"
SESSION_FILE = "session.json"
SESSION_LEEWAY_SECONDS = 5
# Mint a new JWT once the cached one has less than this left: a long Convex call must not
# outlive the token it started with.
MINT_REFRESH_SECONDS = 20
MINT_TIMEOUT_SECONDS = 10.0
MAX_TOKEN_LENGTH = 8192
USER_AGENT = "Unitalk-Hermes-KnowledgeBase/1"

_SESSION_ID_RE = re.compile(r"^sess_[A-Za-z0-9]{1,64}$")
_ORG_ID_RE = re.compile(r"^org_[A-Za-z0-9]{1,64}$")
_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")
# Clerk answers these when the session is over (signed out, revoked, expired or unknown).
_ENDED_STATUSES = {401, 403, 404, 410, 422}

_lock = threading.Lock()
_mint_lock = threading.Lock()
_sessions: dict[str, tuple[str, int]] = {}
_clerk_transport: httpx.BaseTransport | None = None


class SessionEnded(Exception):
    """Clerk refused to mint a token: the session is over."""


class OrganizationUnavailable(Exception):
    """Clerk refused the organization (the user is not, or no longer, a member). The session itself is fine."""


def read_setting(name: str) -> str | None:
    try:
        from agent.secret_scope import get_secret
    except ImportError:
        value = os.environ.get(name)
    else:
        try:
            value = get_secret(name)
        except Exception:
            value = None
    value = (value or "").strip()
    return value or None


def site_url() -> str | None:
    value = read_setting(SITE_URL_ENV)
    return value.rstrip("/") if value else None


def configured() -> bool:
    return site_url() is not None


def api_key() -> str | None:
    for name in KEY_ENVS:
        value = read_setting(name)
        if value:
            return value
    return None


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def token_expiry(token: str) -> int | None:
    parts = token.split(".")
    if len(parts) != 3 or len(token) > MAX_TOKEN_LENGTH:
        return None
    try:
        payload = json.loads(_b64url_decode(parts[1]))
    except (ValueError, UnicodeDecodeError):
        return None
    exp = payload.get("exp") if isinstance(payload, dict) else None
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None
    return int(exp)


def _now() -> int:
    return int(time.time())


def _usable(exp: int, margin: int = SESSION_LEEWAY_SECONDS) -> bool:
    return exp > _now() + margin


def _data_dir():
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir(PLUGIN_NAME)


def _home_key() -> str:
    from hermes_constants import get_hermes_home

    return str(get_hermes_home())


def _read_store() -> dict[str, Any]:
    from utils import read_json_or_empty

    data = read_json_or_empty(_data_dir() / SESSION_FILE)
    return data if isinstance(data, dict) else {}


def _write_store(data: dict[str, Any]) -> None:
    from utils import atomic_json_write

    atomic_json_write(_data_dir() / SESSION_FILE, data, mode=0o600)


# --- Clerk session credentials (Unitalk Desktop) -------------------------------------------------


def normalize_credentials(
    session_id: str, client_token: str, frontend_api: str, organization_id: str | None
) -> dict[str, Any]:
    """Validate pushed credentials; raise ValueError when malformed."""
    session_id, client_token = (session_id or "").strip(), (client_token or "").strip()
    organization_id = (organization_id or "").strip() or None
    if not _SESSION_ID_RE.match(session_id):
        raise ValueError("invalid_session_id")
    if not client_token or len(client_token) > MAX_TOKEN_LENGTH or any(c.isspace() for c in client_token):
        raise ValueError("invalid_client_token")
    if organization_id is not None and not _ORG_ID_RE.match(organization_id):
        raise ValueError("invalid_organization_id")
    parts = urlsplit((frontend_api or "").strip().rstrip("/"))
    host = (parts.hostname or "").lower()
    if (
        parts.scheme != "https"
        or not _HOST_RE.match(host)
        or parts.port is not None
        or parts.path
        or parts.query
        or parts.username
        or parts.password
    ):
        raise ValueError("invalid_frontend_api")
    return {
        "kind": "clerk_client",
        "sessionId": session_id,
        "clientToken": client_token,
        "frontendApi": f"https://{host}",
        "organizationId": organization_id,
    }


def _stored_credentials() -> dict[str, Any] | None:
    data = _read_store()
    if data.get("kind") != "clerk_client":
        return None
    try:
        creds = normalize_credentials(
            data.get("sessionId"), data.get("clientToken"), data.get("frontendApi"), data.get("organizationId")
        )
    except (ValueError, TypeError, AttributeError):
        return None
    token, exp = data.get("token"), data.get("exp")
    if isinstance(token, str) and token and isinstance(exp, int) and not isinstance(exp, bool):
        creds["token"], creds["exp"] = token, exp
    return creds


def _same_identity(a: dict[str, Any] | None, b: dict[str, Any]) -> bool:
    return bool(a) and all(a.get(k) == b.get(k) for k in ("sessionId", "frontendApi", "organizationId", "clientToken"))


def mint_token(creds: dict[str, Any]) -> tuple[str, int, str | None]:
    """Mint a fresh session JWT from Clerk's Frontend API.

    Returns (jwt, exp, rotated_client_token_or_None). Raises SessionEnded when Clerk says the
    session is over, httpx.HTTPError / ValueError on transient or malformed answers.
    """
    url = f"{creds['frontendApi']}/v1/client/sessions/{creds['sessionId']}/tokens"
    # Always explicit: an empty organization_id asks for the personal account, so a token never
    # silently follows the session's last active organization.
    data = {"organization_id": creds.get("organizationId") or ""}
    with httpx.Client(timeout=MINT_TIMEOUT_SECONDS, transport=_clerk_transport) as client:
        response = client.post(
            url,
            params={"_is_native": "1"},
            data=data,
            headers={"Authorization": f"Bearer {creds['clientToken']}", "User-Agent": USER_AGENT},
        )
    if response.status_code in _ENDED_STATUSES:
        if _error_code(response).startswith("organization_"):
            raise OrganizationUnavailable(_error_code(response))
        raise SessionEnded(str(response.status_code))
    response.raise_for_status()
    jwt = (response.json() or {}).get("jwt")
    exp = token_expiry(jwt) if isinstance(jwt, str) else None
    if exp is None:
        raise ValueError("Clerk returned no usable session token")
    rotated = (response.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    return jwt, exp, rotated if rotated and rotated != creds["clientToken"] else None


def _error_code(response: httpx.Response) -> str:
    try:
        errors = response.json().get("errors")
        code = errors[0].get("code") if isinstance(errors, list) and errors else ""
    except (ValueError, AttributeError, TypeError):
        code = ""
    return code if isinstance(code, str) else ""


def store_credentials(
    session_id: str, client_token: str, frontend_api: str, organization_id: str | None = None
) -> int:
    """Store desktop credentials after proving they work; returns the minted token's expiry.

    Re-pushing the same credentials while the cached token is still fresh does not call Clerk.
    """
    creds = normalize_credentials(session_id, client_token, frontend_api, organization_id)
    with _mint_lock:
        current = _stored_credentials()
        if _same_identity(current, creds) and current.get("exp") and _usable(current["exp"], MINT_REFRESH_SECONDS):
            return current["exp"]
        jwt, exp, rotated = mint_token(creds)
        if rotated:
            creds["clientToken"] = rotated
        _write_store({**creds, "token": jwt, "exp": exp})
    with _lock:
        _sessions[_home_key()] = (jwt, exp)
    return exp


def _token_from_credentials() -> str | None:
    creds = _stored_credentials()
    if creds is None:
        return None
    if creds.get("exp") and _usable(creds["exp"], MINT_REFRESH_SECONDS):
        return creds["token"]
    with _mint_lock:
        creds = _stored_credentials()  # another thread may have minted meanwhile
        if creds is None:
            return None
        if creds.get("exp") and _usable(creds["exp"], MINT_REFRESH_SECONDS):
            return creds["token"]
        try:
            jwt, exp, rotated = mint_token(creds)
        except SessionEnded:
            clear_session()
            return None
        except OrganizationUnavailable:
            # Removed from the organization: no token for it, but keep the session; the desktop
            # pushes the next organization (or the personal account) when the user switches.
            return None
        except (httpx.HTTPError, ValueError):
            # Clerk unreachable: fall back to the last token while it still works.
            return creds["token"] if creds.get("exp") and _usable(creds["exp"]) else None
        if rotated:
            creds["clientToken"] = rotated
        creds["token"], creds["exp"] = jwt, exp
        _write_store(creds)
        return jwt


# --- Bare session JWT (browser Webapp) -----------------------------------------------------------


def store_session(token: str) -> int:
    token = token.strip()
    exp = token_expiry(token)
    if exp is None or not _usable(exp):
        raise ValueError("invalid_session_token")
    _write_store({"token": token, "exp": exp})
    with _lock:
        _sessions[_home_key()] = (token, exp)
    return exp


def clear_session() -> None:
    with _lock:
        _sessions.pop(_home_key(), None)
    try:
        (_data_dir() / SESSION_FILE).unlink()
    except FileNotFoundError:
        pass


def _stored_session() -> tuple[str, int] | None:
    data = _read_store()
    if data.get("kind"):
        return None
    token, exp = data.get("token"), data.get("exp")
    if not isinstance(token, str) or not token or isinstance(exp, bool) or not isinstance(exp, int):
        return None
    return token, exp


def _token_from_pushed_jwt() -> str | None:
    key = _home_key()
    with _lock:
        cached = _sessions.get(key)
    if cached is None or not _usable(cached[1]):
        cached = _stored_session()
        if cached is not None:
            with _lock:
                _sessions[key] = cached
    if cached is None or not _usable(cached[1]):
        return None
    return cached[0]


def _claims(token: str) -> dict[str, Any]:
    try:
        payload = json.loads(_b64url_decode(token.split(".")[1]))
    except (IndexError, ValueError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def current_scope() -> str:
    """Whose knowledge bases the current credentials see: ``<user>:<org or personal>``.

    Read from the stored session (no network). Base ids differ per scope, so per-scope state such as
    the active-bases selection is keyed by it. A gateway key has a single fixed scope.
    """
    if api_key():
        return "key"
    data = _read_store()
    claims = _claims(data["token"]) if isinstance(data.get("token"), str) else {}
    user = claims.get("sub") if isinstance(claims.get("sub"), str) else ""
    org = None
    if data.get("kind") == "clerk_client":
        org = data.get("organizationId")
    else:
        v2 = claims.get("o") if isinstance(claims.get("o"), dict) else {}
        org = v2.get("id") or claims.get("org_id")
    if not user:
        return "anonymous"
    return f"{user}:{org if isinstance(org, str) and org else 'personal'}"


def session_mode() -> str | None:
    """'credentials' (desktop, self-refreshing), 'token' (pushed JWT) or None."""
    data = _read_store()
    if data.get("kind") == "clerk_client":
        return "credentials"
    return "token" if data.get("token") else None


def session_token() -> str | None:
    if session_mode() == "credentials":
        return _token_from_credentials()
    return _token_from_pushed_jwt()


def auth_headers() -> dict[str, str] | None:
    key = api_key()
    if key:
        return {KEY_HEADER: key}
    token = session_token()
    if token:
        return {"Authorization": f"Bearer {token}"}
    return None
