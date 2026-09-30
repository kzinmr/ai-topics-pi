---
name: source-triage
description: Select collected blog or newsletter articles for Wiki ingestion, or group the nightly checkpoint into themes without editing Wiki pages.
---

Compare candidates with ~/wiki/index.md and related pages. Read raw_path to
verify the body; source names and estimated newsletter topics can be wrong.
Prefer primary evidence, new technical detail, changed capabilities and genuine
coverage gaps. Treat routine marketing, repetition and unsupported speculation
as skip/reference. This stage does not edit Wiki or checkpoint files.

For blog/newsletter triage return one JSON object:
```json
{
  "checkpoint_run_id": "exact input run_id",
  "decisions": [
    {"item_id": "exact candidate item_id", "recommended_action": "take", "reason_ja": "既存ページにない検証可能な技術情報", "body_excerpt": "brief source evidence", "related_pages": ["concepts/example"]}
  ]
}
```
Return exactly one decision per candidate, including skip entries. The runner
attaches canonical url/raw_path/title from the input. Allowed actions are take,
reference and skip. Empty input requires an empty decisions array, not [SILENT].

For dreaming-group, echo `_checkpoint.run_id` as checkpoint_run_id and return
`groups`, each containing `theme`, `summary_ja`, `articles` (objects with source
url/raw_path or the supplied article identity), and `related_pages`. Summaries
should identify a relationship supported by the sources, not just share keywords.
Empty input requires an empty groups array. Do not invent articles or URLs.
