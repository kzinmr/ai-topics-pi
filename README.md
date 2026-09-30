# ai-topics-pi

Lucy の AI 情報収集と Karpathy 型 LLM Wiki 運用を、**Pi 単独**で実行します。
コンテンツ・feed 定義は [ai-topics](https://github.com/kzinmr/ai-topics)、運用コードはこの repository が管理します。

- 推論・ツール・モデル接続・セッションは Pi。独自の LLM loop、RPC adapter、gateway はありません。
- RSS / newsletter / X / sitemap の収集は独立 Python script。選別・統合・保守は Pi の prompt / skill。
- Lucy の30ジョブ、UTC 時刻、有効27・停止3を保持（[ジョブ対応表](docs/jobs.md)）。定時起動は OS、二重実行防止と実行記録は小さな Python runner。
- Local LLM と OpenAI 互換 API は **Pi 標準の models.json** で切替。Pi `0.99.1` を lock。
- Hermes の import・実行・ディスク互換レイヤーは不要。Nana は対象外。

## 起動

Linux / macOS（POSIX flock）、Python 3.12+、Node.js 22+、Git が必要です。
Windows は WSL / Docker。RSS / X CLI の導入時のみ Go も使用します。

```sh
git clone https://github.com/kzinmr/ai-topics-pi.git
cd ai-topics-pi
npm ci --ignore-scripts
uv sync --frozen --extra collectors
export AI_TOPICS_PROFILE="$PWD/profiles/lucy"
bin/wiki init --content-source https://github.com/kzinmr/ai-topics.git
bin/wiki validate
bin/wiki doctor
```

`uv` がない場合は `python3 -m venv .venv` と
`.venv/bin/pip install --require-hashes -r requirements.lock` を使用できます。
`init` は空の profile 専用。`--content-source` 省略時は空の練習用 Wiki を作ります。
既存 Lucy の移植は [移行手順](docs/migration.md) を参照してください。

1. `$AI_TOPICS_PROFILE/.pi/agent/models.json` に接続先と実在する model ID を設定。
2. `.ai-topics/local.json` の `pi.provider` / `pi.model` を選択。
3. 必要な秘密値を `.ai-topics/secrets.json` に JSON で記入し `chmod 600`。例は `config/secrets.example.json`。
4. RSS / X が必要なら `tools/install-source-tools`。新規 RSS DB は `bin/wiki script import_opml.py` で feed 登録。X 認証は [移行手順](docs/migration.md) のとおり destination profile で行います。

```sh
bin/wiki pi -- --list-models
bin/wiki pi -- --print 'Reply only OK. Do not use tools.'
bin/wiki run blog-triage --dry-run  # 収集・API呼出しなし
bin/wiki run blog-ingest
bin/wiki run blog-triage
bin/wiki run blog-wiki-ingest
bin/wiki status
```

上記 run は実際の収集・モデル処理を行います。newsletter collector はメールを
Processed フォルダーへ COPY 後に元メールへ Deleted を設定し expunge するため、
移行時は移行元と同時に実行しないでください。

対話作業は `bin/wiki pi`。常駐サービスは不要です。
毎分 `bin/wiki tick` を起動する [systemd / cron / Docker の手順](docs/deployment.md) を用意しています。

## モデル接続

`config/models.example.json` に localhost と外部 API の二つの例があります。
Pi は `openai-completions` で Ollama、vLLM、llama.cpp、LM Studio、各種互換 proxy を利用できます。
API key は `"$COMPATIBLE_API_KEY"` のように環境変数を参照します。
認証不要の local server には dummy key を設定します。
対応する contextWindow / maxTokens を実モデルに合わせてください。

モデルの切替は `.ai-topics/local.json` だけで可能です。
```json
{"pi": {"provider": "compatible", "model": "your-model-id", "thinking": "off"}}
```

Pi native provider / OAuth も利用可能。詳細は固定版 package 内の
`node_modules/@earendil-works/pi-coding-agent/docs/models.md`、または
[Pi 公式 Custom Models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)。
モデルごとの tool calling 能力と API compatibility は実接続で確認してください。

## 通知と Git 公開

初期設定は `.ai-topics/outbox/` へのローカル保存。通知を使う route に
`{"kind":"command","command":["wiki-deliver"]}` を設定すると、operations / hot-posts は
Discord、digest は Telegram に送信します。`wiki-deliver` の代わりに任意のコマンドを指定でき、
stdin の JSON envelope を受け取ります。失敗分は `bin/wiki outbox --deliver` で再送できます。

初期設定では変更をローカルに残します。`bin/wiki publish` で Wiki のみ stage / commit / push。
無人公開する場合は local.json に `"publish": true` を設定し、profile の Git identity / 認証を
準備してください。元コンテンツの pre-commit hooks をそのまま実行します。
通知・push の失敗によって収集や推論をやり直しません。push の再試行は `publish` です。

## 拡張と検証

新しい情報源は JSON を stdout に出す `scripts/*.py`、新しい運用は `prompts/*.md` と
`config/jobs.json` で追加。Pi 自体の機能追加は local.json の `pi.extensions` に
拡張ファイルのパスを指定します。job ごとの `pi` 設定でモデルや extension を上書きできます。
[設計・制約](docs/architecture.md) に状態契約と拡張点を記載しています。

```sh
npm test
bin/wiki validate
.venv/bin/python -m compileall -q src scripts tests
python3 tools/check-public-tree.py
```

実 Pi CLI + localhost の OpenAI 互換 SSE server による編集テストを含みます。
有料 API・本番収集・実通知はテストから呼びません。[検証記録](docs/validation.md)。
