# Lucy からの移行

既存 Lucy の profile と Pi の profile は別に作ります。既存 gateway を止めずに
読み取りによる rehearsal が可能です。Nana の設定・Wiki は変更しません。

## 1. 独立した destination を作る

```sh
export AI_TOPICS_PROFILE="$PWD/profiles/lucy"
bin/wiki init --content-source /path/to/lucy/ai-topics
bin/wiki import-state /path/to/lucy
```

clone は **commit 済みコンテンツ**を取得します。元 working tree の未 commit 編集は
含みません。元側で整理して commit するか、差分を別途レビューして destination に移す。
origin は kzinmr/ai-topics に設定します。init は destination の AGENTS.md を置換しますが
自動で commit/push はしません。

import-state は read-only SQLite backup で RSS DB を移し、collector の既読 ID と
許可した JSON checkpoint だけをコピーします。旧 profile path を新 root に書き換えます。
モデル認証、メール password、X OAuth、Git 認証、実行 binary、scheduler の定義/履歴、
Hermes session/memory/plugin はコピーしません。移行コード以外に旧 path への依存はありません。
2回目の上書き import は拒否します。変更のある移行元からの rehearsal は、同一時点の
完全な snapshot ではありません。本切替時は移行元収集を止めて新 destination へ再 import。

## 2. 接続を設定する

README の models.json / local.json / secrets.json を設定。RSS/X を利用する場合は
`tools/install-source-tools` で target 用の binary を作成。
RSS DB を import した場合は OPML の再登録不要。X は xurl の認証を destination で行う。
source binary の認証・設定操作には、次のように subprocess の HOME を指定します。

```sh
env HOME="$AI_TOPICS_PROFILE" "$AI_TOPICS_PROFILE/bin/xurl" --help
```

検索には BRAVE_API_KEY または WIKI_SEARCH_COMMAND が必要。
newsletter は EMAIL_IMAP_HOST / EMAIL_ADDRESS / EMAIL_PASSWORD を設定。
RSS 以外を使わない場合、不要 source の job とその後続を config/jobs.json で停止します。
source feeds と hot-topics は ai-topics repository を継続使用します。

## 3. オフライン検証と接続テスト

```sh
bin/wiki doctor
bin/wiki run blog-triage --dry-run
bin/wiki script wiki_health.py --json
bin/wiki script blog_checkpoint.py
bin/wiki script dreaming.py
bin/wiki pi --list-models
bin/wiki pi --print 'Reply only OK. Do not use tools.'
```

最後のコマンドのみ選択した実モデルへ接続します。
既存 checkpoint を import しても Pi の「成功済み実行履歴」は捏造しません。
実 pipeline は collector → triage → Wiki の順で1回ずつ開始してください。

## 4. 本切替

- Hermes の job 状態を退避し、Lucy の source collection と Wiki 書込みを停止。
  Hermes の操作は元 repository の `bin/hermes-lucy` / `bin/hermes-profile` 経由のみ。
- 元コンテンツの未 commit 変更を整理し、停止中に独立した本番 destination を clone / import。
- 小さい1バッチで実 API、保存結果、Git diff、通知先を確認。
- `publish: true` を設定する場合は既存 hooks と Git 認証も検証。
- deploy/wiki.timer 等で tick を有効化。Hermes と同じ情報源/Wikiへ同時書込みさせない。

## 回復と更新

`status` と `.ai-topics/runs/<run>/` を確認。強制終了した `running` は
`recover RUN_ID` で失敗として確定後、必要な段階だけ手動実行します。
`reset-cursor` は現在時刻までの未実行 slot を意図的に捨てる操作です。
通知の再試行は `outbox --deliver`、Git push の再試行は `publish`。

コード更新は tick を止めて `git pull`、`npm ci --ignore-scripts`、
`npm run build`、`uv sync --frozen --extra collectors`、`bin/wiki validate`、`npm test`。
script/skill の profile コピーはなく、code checkout の更新が次回実行に反映されます。
バックアップは停止中に profile 全体を保存（秘密・Pi session を含むため非公開）。
rollback では Pi の書込みを止め、コンテンツ差分と既読状態をレビューしてから元 Lucy を再開。
