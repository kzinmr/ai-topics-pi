# 検証記録 — 2026-09-30

## 確認したもの

- Pi npm package: `@earendil-works/pi-coding-agent@0.99.1`。
  npm install --ignore-scripts 成功、依存監査は検出0件。
- host: Python 3.12.3 / Node.js 24.15.0。
- 自動テスト39件成功（Node.js 32件、Python collectors 7件）。
  固定版の実 Pi SDK と localhost の OpenAI 互換 SSE fixture で
  API key の環境展開、Authorization、Local LLM 用 dummy key、Pi 標準 edit / bash tool、
  最終回答、usage、session 保存、明示的に追加した extension の tool call を検証。
- SDK の一時的な API エラーからの回復、profile HOME / cwd の引渡しと親環境の不変。
- native TUI を pseudo-terminal で起動し、/new、正常終了、profile lock 解放を検証。
- CLI の profile 選択、dry-run の無副作用、失敗時の終了コードと実行記録。
- 失敗した collector の後続停止、triage ID/候補検証、新しい upstream と古い triage の拒否、
  UTC cron、永続 claim/catch-up、profile lock、crash 回復条件、timeout の子プロセス停止。
- raw 不変、失敗した RSS/sitemap URL を既読にしない、空 mailbox の checkpoint 更新、
  nightly checkpoint の集約、backlog の不完全な完了記録を拒否。
- 通知失敗後の独立再試行、Git hooks の実行と wiki/ のみの staging。
- model API error、length、timeout を成功とせず、timeout 後の次の session は成功。
- profile init の上書き拒否、SQLite backup と state path 再配置、credential 非移行。
- TypeScript strict typecheck / build、validate（30 jobs / enabled 27）、Python compileall、
  public-tree 検査、生成した service の systemd-analyze verify 成功。
- Docker の multi-stage build 成功。専用イメージ内でも network none、既存 volume 無しで
  同じ39件のテストが成功。

## Sign in with ChatGPT

2026-09-30 に npm の最新公開版と固定版がともに `0.99.1` であることを確認。
`0.99.0` に `/login openai` による ChatGPT プラン利用が入り、`0.99.1` で配布物の
ログイン module 欠落が修正されています。バージョン更新・OAuth の独自実装は不要でした。

実 Pi SDK に対して、外部認証通信を模擬した追加3テストを host / Docker で実施:

- profile の installation ID、動的 client 登録、PKCE、プラン利用 scope を伴うログインと
  auth.json 保存、別 ModelRuntime での再利用。
- token refresh と更新済み token の保存。更新失敗時に環境の API key へ fallback しないこと。
- SDK worker が保存済み OAuth を環境の API key より優先し、localhost の Responses API に
  Bearer token と指定モデルを送って最終回答を受け取ること。

テストの認証情報はすべて偽物で、実アカウントのブラウザ同意・利用権・残り利用枠・実モデル
接続の検証ではありません。実行手順は README の ChatGPT プラン節を参照してください。
X の提示投稿本文は取得できず、[OpenAI 公式案内](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)、
[Pi リリース](https://github.com/earendil-works/pi/releases/tag/v0.99.1)、固定 package の実装で確認しました。

## 実データによるオフライン rehearsal

移行元 content commit: `f389bb094fee43bf05799ae7efd0fcd482d2b6e5`。
既存 ai-topics-agent commit: `b87a0a20246e08c97ddbf5eacfcffcdbfeaf4bc1`。
TypeScript CLI の local clone と read-only import を隔離された .local/ts-rehearsal へ実施。

- collector state JSON 1,009件、blogwatcher SQLite DB の移行成功。
- doctor: SDK / Git / Python / schema / index / models の存在チェックすべて成功。
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
