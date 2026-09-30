# 検証記録 — 2026-09-30

## 確認したもの

- Pi npm package: `@earendil-works/pi-coding-agent@0.99.1`。
  npm install --ignore-scripts 成功、依存監査は検出0件。
- host: Python 3.12.3 / Node.js 24.15.0。
- unit / integration 23件成功。実 Pi CLI と localhost の OpenAI 互換 SSE fixture で
  API key の環境展開、Authorization、Pi 標準 edit tool、最終回答、usage、session 保存を検証。
- 失敗した collector の後続停止、triage ID/候補検証、新しい upstream と古い triage の拒否、
  UTC cron、永続 claim/catch-up、profile lock、crash 回復条件、timeout の子プロセス停止。
- raw 不変、失敗した RSS/sitemap URL を既読にしない、空 mailbox の checkpoint 更新、
  nightly checkpoint の集約、backlog の不完全な完了記録を拒否。
- 通知失敗後の独立再試行、Git hooks の実行と wiki/ のみの staging。
- model API error、aborted、length、未完了イベントを成功としない。
- profile init の上書き拒否、SQLite backup と state path 再配置、credential 非移行。
- validate: 30 jobs / enabled 27。Python compileall、public-tree 検査、skill validator、
  systemd-analyze verify 成功。
- Docker build 成功。専用イメージ内で network none、既存 volume 無しのテストも実施。

## 実データによるオフライン rehearsal

移行元 content commit: `f389bb094fee43bf05799ae7efd0fcd482d2b6e5`。
既存 ai-topics-agent commit: `b87a0a20246e08c97ddbf5eacfcffcdbfeaf4bc1`。
local clone と read-only import を隔離された .local/rehearsal へ実施。

- collector state JSON 1,008件、blogwatcher SQLite DB の移行成功。
- doctor: Pi / Git / schema / index / models の存在チェックすべて成功。
- Wiki health collector: entities 934、concepts 2,102、comparisons 35、raw articles 9,979。
  これは検査の実行確認であり、既存 Wiki の全 issue 解消を意味しません。
- index validator: 3,136行、既知の破損パターン検出なし。
- nightly collector: 最近の archive から872記事を収集し、既定の100記事上限を適用。
  truncated を出力に明示。AI_TOPICS_DREAMING_LIMIT でモデル容量に合わせて調整可能。

コピー先だけを操作し、移行元のコンテンツ、秘密情報、cron、gateway は変更していません。
rehearsal / raw logs / imported state は Git から除外しています。

## 未実施 / 切替時の確認

- 本番 Local LLM / 外部 API の実認証、長文品質、Wiki 編集品質、context 容量。
  localhost fixture は protocol と tools の検証であり、実モデル品質の検証ではありません。
- 外部 RSS / X / IMAP / sitemap の実収集、実 Discord / Telegram 配信。
- ai-topics コンテンツへの本番 push、Hermes 停止、Pi の定期起動有効化。
- macOS / WSL / ARM での実行、optional Go CLI の target ごとのビルド。

有効化は migration.md / deployment.md に従い小さい1バッチから行ってください。
