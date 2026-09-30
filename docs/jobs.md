# Lucy ジョブ対応

2026-09-30 の live profile と照合。時刻は UTC。停止状態は保持。

| job | schedule | enabled | execution |
|---|---|---|---|
| blog-triage | `20 10 * * *` | true | script → Pi |
| blog-wiki-ingest | `40 10 * * *` | true | Pi |
| blog-ingest | `0 10 * * *` | true | script only |
| check-skill-inventory | `0 16 * * 0` | true | script only |
| weekly-ai-digest | `0 0 * * 1` | true | Pi |
| dreaming-collect | `0 18 * * *` | true | script only |
| dreaming-group | `10 18 * * *` | true | script → Pi |
| dreaming-wiki-ingest | `20 18 * * *` | true | Pi |
| trending-topics | `0 12 * * *` | true | Pi |
| wiki-graph-analysis | `0 15 * * 5` | true | Pi |
| wiki-health | `0 17 * * *` | false | Pi |
| newsletter-ingest | `10 10 * * *` | true | script only |
| newsletter-triage | `30 10 * * *` | true | script → Pi |
| newsletter-wiki-ingest | `50 10 * * *` | true | Pi |
| x-bookmarks-ingest | `30 11,23 * * *` | true | script → Pi |
| x-accounts-scan | `30 22 */2 * *` | true | script only |
| skeleton-enrich-daily | `0 19 * * *` | true | Pi |
| wiki-health-plan | `10 17 * * *` | false | script → Pi |
| wiki-health-fix | `50 17 * * *` | true | script → Pi |
| ai-topics-slack-hot-posts | `30 0,12,18 * * *` | true | script → Pi |
| active-crawl | `0 11 * * *` | true | Pi |
| sitemap-monitor | `0 6 * * *` | true | script only |
| tag-audit-weekly | `0 10 * * 1` | true | script → Pi |
| pipeline-watchdog | `0 0,6,12,18 * * *` | true | script only |
| wiki-watchdog-fix | `35 17 * * *` | true | script → Pi |
| raw-backlog-ingest | `0 0,4,10,14,18,22 * * *` | false | script → Pi |
| jp-to-en-translation | `0 0 * * 0` | true | Pi |
| skill-drift-check | `0 10 * * 1` | true | script only |
| llm-pricing-monitor | `0 10 * * 1` | true | Pi |
| hierarchy-candidate-detection | `0 15 * * 3` | true | Pi |

check-skill-inventory / skill-drift-check は Pi native skill の inventory と code drift 検査へ置換。
nightly collection は移植後の RSS/newsletter checkpoint archive を使用。
raw-backlog は batch completion JSON を検証し、完了済み記事の再選択を防止。
移行前の巨大な個別 skill/reference 群は配布せず、共通運用契約と2つの短い Pi skill に整理。
旧 browser/gateway/kanban/plugin、agent の自己書換え・自己 skill 昇格は含まない。
ソース取得不能時は報告し、ブラウザ拡張等が必要な環境は Pi extension で追加する。
