# Todo入力フォルダ

`scripts/analyze-todo-sources.js` は以下の入力を解析して、TodoソースJSONを更新します。

- `data/todo-input/mails/`  
  `.txt` / `.md` / `.eml` を解析し、`data/todo-sources/mail-todos.json` を生成
- `data/todo-input/meeting-docs/`  
  `.docx` / `.pdf` / `.txt` / `.md` を解析し、`data/todo-sources/meeting-log-todos.json` を生成  
  **※ 画像だけのスキャンPDFは文字が取れないため解析できません。Word 等から `.docx` で保存するか、テキストが選択できるPDFにしてください。**

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

### 打合せ記録（.docx）向け

- `1.` / `1）` / `（１）` 形式の**番号付き行**も、行末が依頼・作業らしければ抽出します（打合せ用のキーワードはメールより広め）。
- 1ファイルあたりの上限は環境変数 `TODO_REPORT_MEETING_TASK_MAX`（既定 **25**）。多すぎる場合は数を下げる。

## Dropbox から打合せ簿を同期（オプション）

GitHub Actions やローカルで **Mac を開かずに**打合せ簿を取り込むには、Dropbox API のアクセストークンとフォルダパスを設定します。

```bash
npm run sync-meeting-docs-dropbox
```

環境変数:

- `TODO_REPORT_DROPBOX_ACCESS_TOKEN` … Dropbox アプリで発行したトークン
- `TODO_REPORT_DROPBOX_MEETING_PATH` … 同期元フォルダ（例: `/業務/打合せ完成`）
- `TODO_REPORT_MEETING_INPUT_DIR` … 省略時は `data/todo-input/meeting-docs`

取得する拡張子は `.docx` / `.pdf` / `.txt` / `.md` のみ（解析できないスキャンPDFは従来どおり避けてください）。

`run-todo-report` の前段で自動実行されます。トークン未設定時はスキップし、リポジトリ内の `meeting-docs` のみで解析します。

## 受信箱の直接巡回（IMAP）

`.env` または GitHub Secrets に IMAP を設定すると、`npm run fetch-todo-mails:imap` で受信箱から `.eml` を自動保存できます。

- `TODO_REPORT_MAIL_IMAP_HOST`（例: `imap.gmail.com` / `outlook.office365.com`）
- `TODO_REPORT_MAIL_IMAP_PORT`（通常 `993`）
- `TODO_REPORT_MAIL_IMAP_SECURE`（通常 `1`）
- `TODO_REPORT_MAIL_IMAP_USER`
- `TODO_REPORT_MAIL_IMAP_PASS`（アプリパスワード推奨）

保存先は `data/todo-input/mails/` です。  
`run-todo-report` / `run-todo-report:preview` では巡回→解析が自動で実行されます。

### 許可リスト（客先・担当者のみ）

既定では `config/todo-mail-allowlist.json` にある送信元メールアドレスだけを保存します（**Envelope の From / Reply-To / Sender** と照合）。転送メールは元送信者が **Reply-To** に残ることがあるため、その場合も拾えます。

上書きしたい場合:

- 環境変数 `TODO_REPORT_MAIL_ALLOWLIST`（カンマ区切り）
- または `TODO_REPORT_MAIL_ALLOWLIST_PATH` で JSON を指定

許可リストが **空** のときだけ、フィルタせず全件を対象にします。

### Mac のメール（iCloud 等）で受けている場合の例

Mac に届くアカウントが iCloud（`@icloud.com` / `@me.com`）なら、IMAP は通常 `imap.mail.me.com`（ポート993）。Apple ID の **アプリ用パスワード** を `TODO_REPORT_MAIL_IMAP_PASS` に設定します。

会社の Outlook から **自動転送** されている場合、一覧に載っているアドレスが **From にそのまま出ない** ことがあります。そのときは実際の `.eml` を1件見て From を確認し、`todo-mail-allowlist.json` に追加してください。
