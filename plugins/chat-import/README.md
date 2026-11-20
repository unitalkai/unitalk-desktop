# Chat Import

Imports chat history into Hermes sessions, shipped as a backend plugin. The Settings import
menu (Desktop UI plugin) uploads an export to the routes below.

## Sources

| Source | Input | Origin `tool` |
| --- | --- | --- |
| ChatGPT | export zip (`conversations.json` + `user.json` / `chat.html`) | `chatgpt` |
| Claude | export zip (`conversations.json`) or manifest + zips | `claude` |
| Grok | export zip (`prod-grok-backend.json`) | `grok` |
| Private assistant | Convex `hermesChatSync` push to `POST /api/sessions/import` | `unitalk` |

Conversations are written with `SessionDB.import_foreign_history`, keyed by
`{tool, foreign_session_id}`: re-importing the same export never duplicates a session, and
colliding titles get a unique suffix.

## Backend routes

Mounted under `/api/plugins/chat-import/` and authenticated by the gateway:

- `POST /preview` → detected format, conversation count and titles
- `POST /import` → starts a background import job
- `GET /jobs/{jobId}` → progress, imported, skipped and failed conversations

Every route currently answers `501 Not implemented`.

## Verification

```sh
scripts/run_tests.sh tests/plugins/test_chat_import_api.py
```
