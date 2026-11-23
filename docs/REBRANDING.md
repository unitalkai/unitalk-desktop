# Rebranding Methodology

How Unitalk Desktop transforms Hermes Agent into a branded enterprise distribution. This doc explains *why* and *how* — for the script that does it, see `scripts/apply-unitalk-branding.sh`.

## Two-Layer Branding Concept

The rebranding operates on two distinct layers:

| Layer | Hermes term | Unitalk term | Scope |
|---|---|---|---|
| **AI Entity** | "Hermes Agent" | "AI Collaborator" | System prompt identity, help guidance, model-facing text |
| **Product/App** | "Hermes" | "Unitalk" | UI strings, i18n, onboarding, shared metrics, README |
| **Company** | "Nous Research" | "Unitalk" | Attribution strings, consent dialogs |

### Why two layers?

The default identity calls the AI a collaborator and credits Unitalk AI and the Hermes Agent harness. A custom `SOUL.md` can replace this persona.

The product is called "Unitalk" everywhere the user sees it: the app title, onboarding screens, consent dialogs, README.

## Substitution Rules

| Pattern | Replacement | Context | Where applied |
|---|---|---|---|
| Default identity | `You are an AI collaborator created by Unitalk AI, powered by the Hermes Agent harness.` | Shared seeded and fallback persona | `hermes_cli/default_soul.py` `DEFAULT_SOUL_MD` |
| `For help with Hermes Agent itself` | `For help with Unitalk AI Collaborator itself` | Help guidance opening — don't touch the skill/docs references that follow | `agent/prompt_builder.py` `HERMES_AGENT_HELP_GUIDANCE` |
| `I'm Hermes` | `I'm Unitalk` | First-run greeting text | `agent/onboarding_text.py` `GREETING`, `_GREETINGS` |
| `the Hermes desktop app` | `the Unitalk desktop app` | Comment text referencing the app | `agent/onboarding_text.py` |
| `the Hermes terminal UI` | `the Unitalk terminal UI` | Comment text | `agent/onboarding_text.py` |
| `the computer running Hermes` | `the computer running Unitalk` | Facts block in onboarding | `agent/onboarding_text.py` |
| `Share with Nous` | `Share with Unitalk` | Shared metrics consent (English) | `apps/desktop/src/i18n/en_shared_metrics.ts` |
| `Partager avec Nous` | `Partager avec Unitalk` | Shared metrics consent (French) | `apps/desktop/src/i18n/fr_shared_metrics.ts` |
| `sends stats to Nous` | `sends stats to Unitalk` | Stats destination description | All `*_shared_metrics.ts` files |
| Hermes Agent (in welcome plugin) | Collaborateur IA | Welcome dashboard greeting | `apps/desktop/src/plugins/welcome/page.tsx` |
| `"I'm Hermes"` in first-run i18n | `"I'm Unitalk"` | Typed intro copy greeting | All `*_first_run.ts` files |
| Hermes (in provider labels) | Unitalk | Provider display names | `apps/desktop/src/components/onboarding/providers.tsx`, `PROVIDER_DISPLAY_NAMES` |
| Geeky theme names (13) | Brand theme names (11) | Theme presets for pro users | `apps/desktop/src/themes/presets.ts` |

## What to NEVER Modify

These identifiers must remain exactly as-is — they're protocol tokens, not branding:

### HTTP Headers
```
X-Hermes-Session-Token
X-Hermes-Signature-256
X-Hermes-Event
X-Hermes-Delivery
X-Hermes-Session-Id
```

### Environment Variables
```
HERMES_HOME
HERMES_DESKTOP_DEV_SERVER
HERMES_DESKTOP_CDP_PORT
```

### Python Module/Function Names
```
hermes_cli
hermes_state_*
hermes_constants
hermes_bootstrap
hermes_logging
hermes_platform
hermes_dir_acl
hermes_time
hermes_agent (the Python package)
```

### Filesystem Paths
```
~/.hermes/
~/hermes-first-task/
```

### External URLs and Identifiers
```
hermes-agent.nousresearch.com/docs
NousResearchInc.HermesAgent (Windows package identity)
```

## How to Verify After Rebranding

### 1. Grep checks

```bash
# Must NOT exist in user-facing UI (these are the old strings):
grep -r "Hermes Agent" apps/desktop/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v '.test.'

# Must NOT exist — old consent text:
grep -r "Partager avec Nous\|Share with Nous" apps/desktop/src/i18n/

# Must STILL exist — protected identifiers:
grep -r "HERMES_HOME" agent/ --include="*.py"
grep -r "hermes-agent.nousresearch.com" agent/ --include="*.py"
```

### 2. Python syntax check

```bash
python3 -m py_compile agent/prompt_builder.py
python3 -m py_compile agent/onboarding_text.py
python3 -m py_compile agent/system_prompt.py
```

### 3. Identifier integrity

No Python identifier should have been renamed from `hermes_` to `unitalk_`:

```bash
# Should return nothing:
grep -roP '\bunitalk_[a-z_]+\b' agent/ --include="*.py"
```

### 4. Theme count

```bash
# Should show 11 themes, not 13:
grep -c "export const [a-z]*Theme:" apps/desktop/src/themes/presets.ts
```

## Pitfalls Discovered

### `onboarding_text.py` trap

The `GREETING` variable was already `"Hi, I'm Unitalk."` — but the `_GREETINGS` dict had 8 locale-specific translations that each needed to say "Unitalk" instead of "Hermes". A blind `sed 's/Hermes/Unitalk/g'` would have corrupted method names (`hermes_cli` etc.), but a targeted `sed "s/I'm Hermes/I'm Unitalk/g"` only catches the greeting string. **Lesson**: check each locale entry in `_GREETINGS` individually.

### Default identity

The default persona is defined in `hermes_cli/default_soul.py` and reused as
`DEFAULT_AGENT_IDENTITY` in `agent/prompt_builder.py`. Keep it aligned with the
repository and Docker `SOUL.md` files when merging upstream.

### MCP transport limit

Not a branding issue per se, but discovered during rebranding: `agent/process_bootstrap.py` sets MCP transport limits that affect how many tools can be loaded. When adding new providers or changing the tool surface, the `direct_limits` in the transport constructor may need adjustment. If tools disappear after rebranding, check this limit.

### Provider display names

The `PROVIDER_DISPLAY_NAMES` object (in `apps/desktop/src/lib/model-status-label.ts`) maps provider IDs to display labels. The upstream uses "Hermes" for the `nous` provider; our fork must use "Unitalk". This is a separate file from `providers.tsx` — both must be checked.
