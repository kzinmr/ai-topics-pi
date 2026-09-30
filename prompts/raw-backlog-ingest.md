---
description: raw backlog ingest
---

Process exactly the raw articles listed in the injected bounded batch. Read their bodies and related pages. Integrate evidence, update index/log and report per-article completion. Do not claim unsaved work as complete.

After verifying the batch, return exactly one JSON object, no Markdown fence:
{"collect_run_id":"exact input collect_run_id","completed":[{"filename":"exact input filename","status":"done","reason_ja":"更新内容と確認結果"}]}
Include every input article exactly once. Use done only after integrating its evidence;
use skipped for a deliberate, explained no-value decision. If a required source or
edit failed, report ok:false instead of pretending the batch is complete. The runner
records receipts so successfully handled raw articles are not selected again.
