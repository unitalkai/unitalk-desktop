# Knowledge Base

Qdrant-backed knowledge bases for Unitalk collaborators, shipped as a backend plugin. The
Settings knowledge base menu (Desktop UI plugin) talks to the routes below; the agent will
search the same bases through a `kb_search` tool.

## Configuration

Set in `~/.hermes/.env`, never in source:

- `QDRANT_URL`
- `QDRANT_API_KEY`

## Backend routes

Mounted under `/api/plugins/knowledge-base/` and authenticated by the gateway:

- `GET /config` → `{ configured }` (no secrets)
- `GET /bases`, `POST /bases`, `DELETE /bases/{baseId}`
- `GET /bases/{baseId}/files`, `POST /bases/{baseId}/files`, `DELETE /bases/{baseId}/files/{fileId}`
- `POST /bases/{baseId}/search`

Every route except `/config` currently answers `501 Not implemented`.

## Open questions

- Collection layout and embedding model already used by the Vertex to Qdrant migration.
- Embeddings endpoint (for example the Unitalk LLM gateway).
- File parsing for PDF and Office documents.

## Verification

```sh
scripts/run_tests.sh tests/plugins/test_knowledge_base_api.py
```
