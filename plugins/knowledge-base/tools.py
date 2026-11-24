from __future__ import annotations

import json
import re
from html import escape
from typing import Any

from . import auth, convex_client, selection

TOOLSET = "knowledge_base"
SEARCH_LIMIT = 10
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

_transport = None

NOT_CONFIGURED_MESSAGE = "The knowledge base is not configured on this Hermes instance (KB_CONVEX_SITE_URL is missing)."
NO_SESSION_MESSAGE = (
    "The knowledge base is not available right now: no Unitalk session is connected. "
    "Ask the user to sign in to Unitalk Desktop, then try again."
)
INVALID_SESSION_MESSAGE = (
    "The knowledge base rejected the current Unitalk session (it may have ended). "
    "Ask the user to sign in to Unitalk Desktop again, then try again."
)
ALL_OFF_MESSAGE = (
    "Knowledge base search is turned off: no knowledge base is selected in the chat's Knowledge menu. "
    "Tell the user they can select one there if they want answers from their documents."
)
INACTIVE_BASES_MESSAGE = (
    "None of the requested knowledge bases is selected in the chat's Knowledge menu. "
    "Search without base_ids to use the selected ones, or ask the user to select these bases."
)
CITATION_INSTRUCTION = (
    "Answer using these chunks when relevant and cite each source as [index] with its file name and page, "
    "for example [1] (report.pdf p.4)."
)

SYSTEM_PROMPT = (
    "The user has a Unitalk knowledge base of their own documents. When a question may be answered by their "
    "documents, call knowledge_search (knowledge_list_bases lists the available bases) and cite the chunks you "
    "use as [index] (fileName p.N)."
)

KNOWLEDGE_SEARCH_SCHEMA = {
    "name": "knowledge_search",
    "description": (
        "Search the user's Unitalk knowledge bases (their uploaded documents) and return the most relevant "
        "chunks with file name, page and similarity score. Only the bases the user selected in the chat's "
        "Knowledge menu are searched. Cite results as [index] (fileName p.N)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to look for, phrased as a natural-language query."},
            "base_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional knowledge base ids to restrict the search to (see knowledge_list_bases).",
            },
        },
        "required": ["query"],
    },
}

KNOWLEDGE_LIST_BASES_SCHEMA = {
    "name": "knowledge_list_bases",
    "description": (
        "List the user's Unitalk knowledge bases (owned and shared) with their ids, file counts and whether each "
        "is active (selected in the chat's Knowledge menu, so knowledge_search uses it)."
    ),
    "parameters": {"type": "object", "properties": {}},
}


def check_available() -> bool:
    try:
        return auth.configured()
    except Exception:
        return False


def system_prompt_section(_info: Any = None) -> str:
    return SYSTEM_PROMPT if check_available() else ""


def _client() -> tuple[Any, str | None]:
    site = auth.site_url()
    if not site:
        return None, NOT_CONFIGURED_MESSAGE
    headers = auth.auth_headers()
    if headers is None:
        return None, NO_SESSION_MESSAGE
    return convex_client.ConvexClient(site, headers, transport=_transport), None


def _error(message: str) -> str:
    return json.dumps({"error": message}, ensure_ascii=False)


def _failure(error: Exception) -> str:
    if isinstance(error, convex_client.ConvexError):
        if error.status_code == 401:
            return _error(INVALID_SESSION_MESSAGE)
        where = f" at step {error.step}" if error.step else ""
        ref = f", ref {error.request_id}" if error.request_id else ""
        return _error(f"Knowledge base request failed ({error.status_code} {error.code}{where}{ref}).")
    return _error("Knowledge base request failed.")


_CLOSING_TAG_RE = re.compile(r"</(chunk|retrieved_chunks)", re.IGNORECASE)


def _body(text: str) -> str:
    return _CLOSING_TAG_RE.sub(r"&lt;/\1", text)


def _attr(value: Any) -> str:
    return escape("" if value is None else str(value), quote=True)


def _score(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return ""
    return f"{value:.3f}"


def format_chunks(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return "No matching chunks were found in the knowledge base."
    lines = ["<retrieved_chunks>"]
    for position, chunk in enumerate(chunks, start=1):
        index = chunk.get("index") if isinstance(chunk.get("index"), int) else position
        text = chunk.get("text") if isinstance(chunk.get("text"), str) else ""
        page = chunk.get("pageNumber")
        lines.append(
            f'<chunk index="{_attr(index)}" fileName="{_attr(chunk.get("fileName"))}" '
            f'pageNumber="{_attr(page if page is not None else "")}" similarity="{_score(chunk.get("score"))}">'
            f"{_body(text)}</chunk>"
        )
    lines.append("</retrieved_chunks>")
    lines.append(CITATION_INSTRUCTION)
    return "\n".join(lines)


def format_bases(result: Any, active: list[str] | None = None) -> str:
    rows = []
    for group in ("owned", "shared"):
        bases = result.get(group) if isinstance(result, dict) else None
        for base in bases if isinstance(bases, list) else []:
            if isinstance(base, dict) and isinstance(base.get("id"), str):
                rows.append(
                    {
                        "id": base["id"],
                        "name": base.get("name"),
                        "fileCount": base.get("fileCount"),
                        "shared": group == "shared",
                        "active": active is None or base["id"] in active,
                    }
                )
    if not rows:
        return "The user has no knowledge base yet."
    return json.dumps({"bases": rows}, ensure_ascii=False)


def handle_knowledge_search(args: dict[str, Any], **_kw: Any) -> str:
    query = args.get("query") if isinstance(args.get("query"), str) else ""
    query = query.strip()
    if not query:
        return _error("query is required")
    base_ids = args.get("base_ids")
    if base_ids is not None:
        if not isinstance(base_ids, list) or not all(isinstance(i, str) and _ID_RE.match(i) for i in base_ids):
            return _error("base_ids must be a list of knowledge base ids")
    active = selection.active_base_ids(auth.current_scope())
    if active is not None:
        if not active:
            return _error(ALL_OFF_MESSAGE)
        base_ids = [i for i in base_ids if i in active] if base_ids else list(active)
        if not base_ids:
            return _error(INACTIVE_BASES_MESSAGE)
    client, problem = _client()
    if problem:
        return _error(problem)
    payload: dict[str, Any] = {"query": query, "limit": SEARCH_LIMIT}
    if base_ids:
        payload["baseIds"] = base_ids
    try:
        result = client.request_sync("POST", "/kb/search", json=payload)
    except convex_client.ConvexError as error:
        return _failure(error)
    chunks = result.get("chunks") if isinstance(result, dict) else None
    return format_chunks([chunk for chunk in chunks if isinstance(chunk, dict)] if isinstance(chunks, list) else [])


def handle_knowledge_list_bases(args: dict[str, Any], **_kw: Any) -> str:
    client, problem = _client()
    if problem:
        return _error(problem)
    try:
        result = client.request_sync("GET", "/kb/bases")
    except convex_client.ConvexError as error:
        return _failure(error)
    return format_bases(result, selection.active_base_ids(auth.current_scope()))
