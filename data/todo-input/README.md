# Todo入力フォルダ

`scripts/analyze-todo-sources.js` は以下の入力を解析して、TodoソースJSONを更新します。

- `data/todo-input/mails/`  
  `.txt` / `.md` / `.eml` を解析し、`data/todo-sources/mail-todos.json` を生成
- `data/todo-input/meeting-docs/`  
  `.docx` / `.txt` / `.md` を解析し、`data/todo-sources/meeting-log-todos.json` を生成

## 推奨フォーマット（最小）

本文に次のような行を含めると抽出精度が上がります。

```text
業務ID: 20260141
業務名: 四條畷市文化財保存活用地域計画策定支援業務委託（2年目）
タスク: 第2回打合せ記録簿の修正
対応期限: 2026/05/08
客先提出期限: 2026/05/09
```

`タスク:` がなくても、箇条書き（`-` / `・`）で「作成・確認・提出・対応」等を含む行は抽出対象になります。

## 受信箱の直接巡回（IMAP）

`.env` または GitHub Secrets に IMAP を設定すると、`npm run fetch-todo-mails:imap` で受信箱から `.eml` を自動保存できます。

- `TODO_REPORT_MAIL_IMAP_HOST`（例: `imap.gmail.com` / `outlook.office365.com`）
- `TODO_REPORT_MAIL_IMAP_PORT`（通常 `993`）
- `TODO_REPORT_MAIL_IMAP_SECURE`（通常 `1`）
- `TODO_REPORT_MAIL_IMAP_USER`
- `TODO_REPORT_MAIL_IMAP_PASS`（アプリパスワード推奨）

保存先は `data/todo-input/mails/` です。  
`run-todo-report` / `run-todo-report:preview` では巡回→解析が自動で実行されます。
