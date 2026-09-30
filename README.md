# ai-topics-pi

Lucy の AI 情報収集と Karpathy 型 LLM Wiki を、**TypeScript runner と Pi SDK** で運用します。
コンテンツ・feed 定義は [ai-topics](https://github.com/kzinmr/ai-topics)、運用コードはこの repository が管理します。

- **TypeScript / Node.js 24**：CLI、定時ジョブ、実行記録、排他、結果検証、通知、Git 公開。
- **Pi SDK**：モデル接続、エージェント実行、標準・拡張ツール、skill / prompt 読込み、セッション管理。
- **独立 Python scripts**：RSS / newsletter / X / sitemap の収集と Wiki の品質検査。
- **Local LLM / OpenAI 互換 API**：Pi 標準の models.json で切替。Pi `0.99.1` を固定。
- Lucy の30ジョブ、UTC 時刻、有効27・停止3を保持。[ジョブ対応表](docs/jobs.md)。Nana は対象外です。

## セットアップ

Linux / macOS、Node.js 24+、Python 3.12+、Git が必要です。Windows は WSL / Docker。
profile は SQLite の file locking に対応したローカル filesystem に置きます。
Pi のファイル検索用に ripgrep と fd も導入してください（Debian/Ubuntu は
`apt install ripgrep fd-find`、macOS は `brew install ripgrep fd`）。Docker image には同梱します。

```sh
git clone https://github.com/kzinmr/ai-topics-pi.git
cd ai-topics-pi
npm ci --ignore-scripts
npm run build
uv sync --frozen --extra collectors
export AI_TOPICS_PROFILE="$PWD/profiles/lucy"
bin/wiki init --content-source https://github.com/kzinmr/ai-topics.git
bin/wiki validate
bin/wiki doctor
```

`uv` がない場合は `python3 -m venv .venv` と
`.venv/bin/pip install --require-hashes -r requirements.lock` を使用できます。
Python project は collector 依存のみを管理し、runner の実行入口は `dist/cli.js` です。
`init` は空の profile 専用。`--content-source` 省略時は空の練習用 Wiki を作ります。
既存 Lucy からデータを移す場合は [移行手順](docs/migration.md) を参照してください。

1. `$AI_TOPICS_PROFILE/.pi/agent/models.json` に接続先と実在する model ID を設定。
2. `.ai-topics/local.json` の `pi.provider` / `pi.model` を選択。
3. 必要な秘密値を `.ai-topics/secrets.json` に JSON で記入し `chmod 600`。例は `config/secrets.example.json`。
4. RSS / X が必要なら Go を用意して `tools/install-source-tools`。新規 RSS DB は
   `bin/wiki script import_opml.py` で feed 登録。X 認証は destination profile で行います。

```sh
bin/wiki pi --list-models
bin/wiki pi --print 'Reply only OK. Do not use tools.'
bin/wiki run blog-triage --dry-run  # 収集・モデル呼出しなし
bin/wiki run blog-ingest
bin/wiki run blog-triage
bin/wiki run blog-wiki-ingest
bin/wiki status
```

`pi --print` は SDK で実行し、回答・usage・session 情報を JSON で返します。
`bin/wiki pi` は同じ SDK 設定を使う Pi 標準 TUI。profile の書込みロックを取得します。
runner の `pi` サブコマンドが受け付けるオプションは `--list-models`、`--print TEXT`、
`--provider`、`--model`、`--thinking` です。TUI 内の `/model`、`/login`、`/new` 等は Pi の機能です。

run は実際の収集・モデル処理を行います。newsletter collector はメールを
Processed フォルダーへ COPY 後に元メールへ Deleted を設定し expunge するため、
同じ mailbox に対する移行元との同時実行は避けてください。

## 構成とモデル設定

OS scheduler が毎分 `wiki tick` を起動し、TypeScript runner が実行する job を選択。
各モデル処理は独立した Node.js worker 内で Pi SDK の session を作り、
`await session.prompt()` の完了後に結果を検証します。SDK worker とは Node IPC で通信します。
収集・通知等の subprocess にも timeout を設け、異常終了を記録します。
[設計](docs/architecture.md) と [systemd / cron / Docker](docs/deployment.md) に詳細があります。

`config/models.example.json` に localhost と外部 API の接続例があります。
`openai-completions` provider の baseUrl と model ID を設定し、認証不要 local server には
dummy key、外部 API には `"$COMPATIBLE_API_KEY"` のような環境変数参照を指定します。
contextWindow / maxTokens / compatibility は実際のモデルに合わせてください。

```json
{"pi": {"provider": "compatible", "model": "your-model-id", "thinking": "off"}}
```

Pi native provider / OAuth も利用可能です。
固定版の `node_modules/@earendil-works/pi-coding-agent/docs/models.md` と
[公式 SDK 文書](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) を参照してください。
`doctor` はローカルの構成を検査します。認証・tool calling・編集品質は実モデルで確認します。

## 通知・公開・拡張

初期設定は `.ai-topics/outbox/` へのローカル保存です。
通知する route に `{"kind":"command","command":["wiki-deliver"]}` を設定すると、
operations / hot-posts は Discord、digest は Telegram に送ります。
任意の配信コマンドへの置換も可能で、stdin に JSON envelope を渡します。
失敗分は `bin/wiki outbox --deliver` で再送。推論や収集は再実行しません。

`bin/wiki publish` は Wiki のみを stage / commit / push し、元コンテンツの Git hooks を実行します。
無人公開は local.json の `"publish": true` で有効化し、profile の Git identity / 認証を設定。
push 失敗の再試行は `publish` です。

新情報源は `scripts/*.py`、新運用は `prompts/*.md` と `config/jobs.json` に追加。
Pi extension は local.json の `pi.extensions` にパスを指定します。job ごとの `pi` でも上書き可能。
SDK の ModelRuntime / ResourceLoader / SessionManager を使い、LLM loop は Pi が担います。

```sh
npm run typecheck
npm test
bin/wiki validate
python3 -m compileall -q scripts tests tools
python3 tools/check-public-tree.py
```

テストは一時 profile と localhost の OpenAI 互換 fixture を使用します。
本番 API・情報源・通知先は呼びません。[検証記録](docs/validation.md)。
