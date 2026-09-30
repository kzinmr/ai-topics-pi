# ai-topics-pi

Lucy の AI 情報収集と Karpathy 型 LLM Wiki を、**TypeScript runner と Pi SDK** で運用します。
コンテンツ・feed 定義は [ai-topics](https://github.com/kzinmr/ai-topics)、運用コードはこの repository が管理します。

- **TypeScript / Node.js 24**：CLI、定時ジョブ、実行記録、排他、結果検証、通知、Git 公開。
- **Pi SDK**：モデル接続、エージェント実行、標準・拡張ツール、skill / prompt 読込み、セッション管理。
- **独立 Python scripts**：RSS / newsletter / X / sitemap の収集と Wiki の品質検査。
- **Local LLM / OpenAI 互換 API**：Pi 標準の models.json で切替。Pi `0.99.1` を固定。
- **ChatGPT サブスクリプション**：Pi 標準の `/login openai` で接続。同じ SDK を定期ジョブにも使用。
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

### ChatGPT プランで OpenAI モデルを利用する

Pi `0.99.0` で追加された **Sign in with ChatGPT** に対応しています。
固定版 `0.99.1` は OpenAI ログインの配布ファイル不備も修正した版です。
利用する provider は **`openai`**。`openai-codex` は従来の別経路です。
[Pi リリース](https://github.com/earendil-works/pi/releases/tag/v0.99.1)・
[OpenAI の案内](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)。

1. 定期ジョブと同じ `AI_TOPICS_PROFILE` を指定して `bin/wiki pi` を起動。
2. TUI 内で `/login openai` を入力し、**Sign in with ChatGPT** を選択。
   ブラウザでログインし、ChatGPT プランの利用を許可します。
3. `/model` で OpenAI のモデルを選び、短い質問で接続を確認。
4. 定期ジョブの `.ai-topics/local.json` の `pi` も次のように変更します。
   model ID は選択したモデルに合わせ、他の設定は保持します。

```json
{"pi": {"provider": "openai", "model": "gpt-6.1-sol", "thinking": "off"}}
```

TUI で保存した Pi の既定モデルより **local.json の明示指定が優先**されます。
job に `pi` があれば、その設定も優先されるため確認してください。
OpenAI の組込み provider を使用するので、models.json への OpenAI 定義の追加や
API key の設定は不要です。認証は profile の `.pi/agent/auth.json`、installation ID は
`.pi/agent/settings.json` に保存され、定期ジョブの SDK worker も同じものを読みます。
Pi が token の更新と保存を担当します。独自の OAuth 実装はありません。

```sh
bin/wiki pi --list-models
bin/wiki pi --provider openai --model gpt-6.1-sol --print 'Reply only OK. Do not use tools.'
```

モデル一覧はローカルの catalog と認証設定の確認です。各アカウントでのモデル利用権や
残り利用枠は保証しません。認証後の最後のコマンドで実際の疎通を確認します。
SSH / Docker でブラウザの callback が届かない場合は、Pi の画面に最終 redirect URL を
貼り付けます。ログイン時と定期実行時に同じ profile / volume を使ってください。

対象プラン・利用枠は OpenAI 側の条件に従います。利用量は既存プランの枠を消費し、
接続アプリごとの上限や追加 credit の利用設定は [ChatGPT Usage](https://chatgpt.com/settings/usage)
で管理します。保存済み OAuth の更新失敗時に API key へ自動 fallback はしません。
ただし `/logout` 後は残っている `OPENAI_API_KEY` 等が使われ得るため、サブスクリプション
専用の profile には OpenAI API key を設定しないでください。

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
