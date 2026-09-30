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

## Docker

image はビルド済み TypeScript runner、Pi SDK、Python collectors を含みます。
Node.js 24 の build stage で npm ci と tsc を実行します。root で profile の
ファイルを作らないよう UID 1000 の wiki user で実行します。

```sh
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml run --rm wiki init --content-source https://github.com/kzinmr/ai-topics.git
docker compose -f deploy/compose.yaml run --rm wiki doctor
```

named volume `profiles` に状態を保存。初期化された models.json と local.json は接続例です。
次の入口から volume 内で編集し、credentials も private volume に設定します。

```sh
docker compose -f deploy/compose.yaml run --rm --entrypoint /bin/sh wiki
# container 内（HOME を operator shell で再定義せず、対象ファイルを明示する）
# /data/lucy/.pi/agent/models.json
# /data/lucy/.ai-topics/local.json
# /data/lucy/.ai-topics/secrets.json
```

runner は SDK worker と collector の子プロセスに profile の HOME と Pi agent directory を渡します。
RSS/X CLI は target と同じ OS/architecture で `tools/install-source-tools` を使いビルドし、
profile/bin へ配置します。Docker image には optional Go compiler と認証済み CLI は含みません。
必要なら別 build stage に Go を追加するか、profile を bind mount して Linux 用 binary を配備。

localhost のモデルは **container 自身**を指します。host のモデルへ接続する場合は
到達可能な host 名を models.json に設定してください。必要に応じ compose の extra_hosts
や専用ネットワークを使います。固定 LAN IP、proxy、tunnel は要求しません。

定時起動も常駐 daemon は不要です。
```sh
docker compose -f deploy/compose.yaml run --rm wiki tick
```
このコマンドを OS scheduler から毎分起動。絶対 compose path を指定してください。
bind mount を使う場合は実行 UID/GID と profile 所有者を合わせます。

## モデル smoke test と未設定 source

`bin/wiki pi --list-models` はモデルの設定確認、`--print` の短い質問は疎通確認。
`doctor` はネットワーク/認証/モデル能力を検証しません。
ChatGPT サブスクリプションを使う場合は、同じ profile / volume の対話 TUI で
`/login openai` → Sign in with ChatGPT を実行し、local.json の provider/model を指定します。
Docker の対話入口は `docker compose -f deploy/compose.yaml run --rm wiki pi`。
OAuth callback がブラウザから届かなければ、最終 redirect URL を Pi に貼り付けます。
不要な source job を manifest で停止し、その依存段階も停止します。
全30 job の定義は Lucy の機能対応を示すもので、認証前に全 source を実行する推奨ではありません。

## バックアップ・保存量

停止中に code revision と profile を保存。Pi session、checkpoint archive、runs、outbox は
自動削除しません。元記事と根拠の追跡可能性を保った上で運用側の保持期間を設定します。
SQLite runs.db の稼働中コピーには SQLite backup を使い、ファイル単体 cp を避けます。
