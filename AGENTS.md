# Development

This repository uses a TypeScript runner and the Pi SDK. Keep model APIs, tools,
resource loading and session lifecycle in Pi. Do not add another agent loop,
harness adapter or daemon. Python is for standalone collectors and inspections.
The OS starts `bin/wiki tick`; SQLite records outcomes and scheduling claims.

Use AI_TOPICS_PROFILE for the profile root, ~/wiki for Wiki content, and
`wiki-script NAME.py` for collector helpers. SDK workers and collectors receive
profile-specific HOME and credentials; do not mutate the parent environment.
Never run collectors, notifications or publication against production as tests.
Keep Nana unchanged. Secrets and run artifacts stay in ignored profile directories.

Validate with `npm test`, `npm run typecheck`, `bin/wiki validate`, Python
compileall for scripts/tests/tools, and `python3 tools/check-public-tree.py`.
SDK tests must use a loopback model fixture and temporary profiles. Preserve the
runs.db schema and checkpoint lineage rules. Update wrappers, Docker, CI, prompts
and documentation together when changing the runtime or path contract.
