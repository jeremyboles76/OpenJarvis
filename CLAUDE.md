# CLAUDE.md — Soloman V2

Local-first, multi-agent AI assistant & control center. Package: `openjarvis` (src layout).

## Architecture (6 pillars)
- **Core LLM** — central orchestrator/planner. Always reason via explicit Chain-of-Thought before acting. → `core/`, `engine/`, `intelligence/`.
- **Tools** — direct environment access: local PC (apps, files, `look_through_camera`, `look_at_screen`), APIs (Email, Gumroad, Sellvia, Crypto Exchanges, Obsidian Vault), generative (image, 3D), web search. → `tools/`, `connectors/`, `operators/`.
- **Specialist Agents** — Researcher, Operations, Fabricator, Coder, Author. Each = refined skill + persistent field notes; feed lessons learned back into notes. → `agents/`, `skills/`, `learning/`.
- **Memory (tiered)** — short-term (chat); long-term (`remember_fact`); Vault (`vault_read_note`/`vault_write_note`); semantic (`recall_memory`). → `sessions/`, `mining/`.
- **Proactive Heartbeat** — background cron monitors reminders, orders, finances; emits "notices". MUST expose a kill-switch. → `scheduler/`, `daemon/`.
- **Safety Gates** — consequential actions (crypto trades, file deletion, product publishing) REQUIRE explicit user approval. Sensitive-file protections stay active. → `security/`, `sandbox/`.

## Code Style
- Modular agents: one responsibility per module; keep agent logic isolated from tool/connector code.
- Strict type hints on every public function/method; no bare `Any`. Target Python 3.10–3.13.
- Errors: never swallow. Catch narrow exceptions, log with context, surface actionable messages. No silent `except: pass`.
- Gate side-effects behind explicit approval checks; never auto-execute a consequential action.
- Lint/format: `ruff`. Deps/run: `uv`. Tests: `pytest` in `tests/`.

## Workflow
- **MANDATORY:** run `/compact` after any major coding milestone to preserve token budget.
- Prefer editing existing modules over new files; match surrounding conventions.
