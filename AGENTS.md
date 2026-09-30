# Development

This repository runs Lucy's workflows using Pi only. Keep model/provider/session
behavior in Pi; do not add harness adapters, an agent daemon or a custom LLM loop.
Collectors are standalone Python programs; prompts and skills use Pi's native
formats. The OS starts `bin/wiki tick`; SQLite records outcomes and scheduling
claims. Never use Hermes paths or imports in runtime code.

Use AI_TOPICS_PROFILE for the profile root, ~/wiki for Wiki content, and
`wiki-script NAME.py` for helper scripts. The wrapper sets subprocess HOME only;
it does not change the operator's HOME. Credentials and run artifacts stay in the
ignored profile. Do not test network collectors or delivery against production.

Validate with `npm test`, `bin/wiki validate`, Python compileall and
`python3 tools/check-public-tree.py`. Use temporary profiles. Update all prompts,
skills, wrappers and deployment documentation together when paths change.
