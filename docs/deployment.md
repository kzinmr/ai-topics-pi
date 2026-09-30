# 配備

## host / systemd user

README の setup 後、設定済み profile の絶対パスを指定して service を生成します。

```sh
mkdir -p "$HOME/.config/systemd/user"
bin/wiki --profile "$AI_TOPICS_PROFILE" systemd-service > "$HOME/.config/systemd/user/wiki.service"
cp deploy/wiki.timer "$HOME/.config/systemd/user/wiki.timer"
systemctl --user daemon-reload
systemctl --user enable --now wiki.timer
journalctl --user -u wiki.service
```

これらは本番実行を有効化するコマンドです。移行元の書込み停止・接続設定を終えてから実行。
必要なら管理者が user の linger を有効にします。停止は `systemctl --user stop wiki.timer`。
処理中も止める場合は service も停止し、次回 `status` / `recover` で interrupted run を確認。

cron の場合、**絶対パス**で毎分 tick を起動します。
```cron
* * * * * AI_TOPICS_PROFILE=/your/profile /your/ai-topics-pi/bin/wiki tick >> /your/profile/tick.log 2>&1
```

schedule の判定はホスト timezone に関係なく UTC。
既に起動中なら busy で終了し、次の tick が未実行 minute を処理します。

## Linux の実行環境と sandbox

Ubuntu 24.04 では管理者が一度だけ `sudo tools/setup-linux-sandbox` を実行します。
配布版 bubblewrap と専用 AppArmor profile、ripgrep、fd を導入します。
他の Linux では `/usr/bin/bwrap` と unprivileged user namespaces を利用可能にしてください。
macOS は現在未対応です。Windows は同じ Linux 構成を WSL2 内で使用します。

```sh
bin/wiki sandbox-check
bin/wiki doctor
```

sandbox-check はモデルや外部サービスを呼ばず、一時 canary によって Wiki/scratch の書込み、
秘密・管理領域の不可視性、raw/script の書込み拒否、symlink とローカル TCP の拒否を実測します。
systemd は ExecStartPre でこの検査を行います。生成時の Node 絶対パスを使用するため、
Node を移設・更新してパスが変わったら service を再生成してください。
定期実行と Pi session は sandbox 起動に失敗すると停止し、ホスト実行へ戻りません。
コード checkout は実行ユーザーが読める canonical path、profile はローカル filesystem に置きます。

LLM 接続・OAuth はホスト上の Pi SDK が扱います。localhost の LLM は同じホストを指します。
認証情報やローカルモデルへの接続設定を、tool sandbox に渡す必要はありません。
ツールには公開 runtime assets、Wiki、読み取り専用 checkpoint と専用 scratch のみを公開します。
`~/wiki/raw` と `~/wiki/transcripts` は常に読み取り専用です。
調査ジョブは `save_raw` で新しい記事を追加でき、既存ファイルの置換は拒否されます。

通信を許可するジョブは `pi.network_jobs` に名前を列挙します。省略時は
active-crawl / trending-topics / x-bookmarks-ingest / x-accounts-scan /
skeleton-enrich-daily / llm-pricing-monitor / dreaming-collect。
`[]` なら全ジョブの tool 通信を停止します。TUI / --print は通信を許可しません。
通信許可時はホストネットワーク全体へのアクセスとなり、ドメイン別の制限はありません。
LLM/OAuth 通信はこの tool 向け制限とは別です。

検索キーはホストの `web_search` tool が使用します。`wiki-search` は運用者向け CLI です。
`wiki-script` は sandbox 内でも使えますが、認証付き収集・公開・通知を行う権限はありません。
分析結果は `$WIKI_WORK_DIR` へ保存します。追加 Pi extensions は信頼済みホストコードとして扱い、
第三者 extension に同じ隔離が自動適用されるとは考えないでください。

RSS/X CLI は `tools/install-source-tools` でホスト向けにビルドし、profile/bin へ配置します。
収集・通知・公開は sandbox 外の runner が実行します。本番は専用 OS ユーザーを推奨します。

## モデル smoke test と未設定 source

`bin/wiki pi --list-models` はモデルの設定確認、`--print` の短い質問は疎通確認。
`doctor` は sandbox とローカル構成を検査します。外部認証やモデル能力は検証しません。
ChatGPT サブスクリプションを使う場合は、同じ profile の `bin/wiki pi` 対話 TUI で
`/login openai` → Sign in with ChatGPT を実行し、local.json の provider/model を指定します。
OAuth callback がブラウザから届かなければ、最終 redirect URL を Pi に貼り付けます。
不要な source job を manifest で停止し、その依存段階も停止します。
全30 job の定義は Lucy の機能対応を示すもので、認証前に全 source を実行する推奨ではありません。

## バックアップ・保存量

停止中に code revision と profile を保存。Pi session、checkpoint archive、runs、outbox は
自動削除しません。元記事と根拠の追跡可能性を保った上で運用側の保持期間を設定します。
SQLite runs.db の稼働中コピーには SQLite backup を使い、ファイル単体 cp を避けます。
