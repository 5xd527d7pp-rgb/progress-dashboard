# 進捗管理ダッシュボード

タスク管理ツール（Linear）のデータを自動で取得し、AIが健康度を判定、HTMLダッシュボードを生成してSlackに画像付きで通知するツールです。

```
┌──────────────────────────────────────────────────────────────┐
│  📊 マガジン進捗管理ダッシュボード                              │
│                                                              │
│  💊 進捗健康度                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │
│  │ 企画案  │ │ 構成   │ │ 原稿   │ │ 動画   │               │
│  │  🟢    │ │  🟡   │ │  🟢   │ │  🔴   │               │
│  │  順調   │ │  注意  │ │  順調  │ │  危険  │               │
│  └────────┘ └────────┘ └────────┘ └────────┘               │
│                                                              │
│  🤖 AIからの提案                                              │
│  🔥 優先度：高 ─ 動画編集が3日遅延...                          │
│  🧭 優先度：中 ─ 原稿の引き継ぎを...                           │
│  🌱 優先度：低 ─ ナレッジを蓄積...                             │
│                                                              │
│  📋 マガジン別ステータス / 📅 カレンダー                        │
└──────────────────────────────────────────────────────────────┘
```

Slackにはこのダッシュボードのスクリーンショットが3枚届きます。ブラウザで詳細も確認できます。

一人でも使えます。自分のLinearにタスクを登録すればダッシュボードが動きます。チームメンバーがいなくても問題ありません。

---

## 料金について

このツールで使う外部サービスはすべて無料枠で利用できます。

| サービス | 用途 | 料金 |
|---|---|---|
| Linear | タスク管理（データの取得元） | Free プランで十分 |
| Gemini API | AIによる改善提案の生成 | 無料枠あり |
| Surge | ダッシュボードHTMLの公開 | 無料 |
| Slack | ダッシュボード画像の通知先 | 無料ワークスペースで可 |
| GitHub Actions | 定期自動実行（オプション） | 毎月 2,000 分無料 |

---

## このツールの4パーツ

第3回講義で学んだ「4パーツ」が、このツールではどのファイルに対応しているかを示します。

```
┌─────────────┐
│  トリガー     │  .github/workflows/run-dashboard.yml
│  （いつ動く） │  → 毎朝9時 or 手動実行
└──────┬──────┘
       ▼
┌─────────────┐
│  ソース元    │  scripts/fetch-data.js
│  （データ）  │  → Linear API からタスクデータを取得
└──────┬──────┘
       ▼
┌─────────────┐  scripts/calculate-health.js    ← 健康度を計算
│  処理する場所 │  scripts/generate-ai-suggestions.js ← AIが提案を生成
│  （加工）    │  scripts/generate-dashboard.js  ← HTMLを組み立てる
└──────┬──────┘
       ▼
┌─────────────┐  scripts/deploy-to-surge.js  → ウェブに公開
│  届ける先    │  scripts/take-screenshot.js → 画像に変換
│  （配信）    │  scripts/post-to-slack.js   → Slack に通知
└─────────────┘
```

---

## セットアップ

### 準備するもの

- Node.js 18 以上（持っていない場合は AI に「Node.jsをインストールして」と依頼）
- Linear アカウント（持っていない場合は Part B で作成します）
- Google アカウント（持っていない場合は Part C の前に作成してください）
- Slack ワークスペース（持っていない場合は Part D で作成します）

### Part A: リポジトリを開く

1. Giteaからリポジトリをクローンする
2. Cursorでフォルダを開く
3. ターミナルを開いて依存関係をインストールする

ターミナルの開き方: Cursor/VSCode のメニュー「Terminal」→「New Terminal」、またはキーボードで `` Ctrl + ` ``（バッククォート）を押す。

```bash
npm install
```

### Part B: Linear API キーを取得する

Linear はタスク管理ツールです。このツールのデータ取得元になります。

1. [Linear](https://linear.app/) にアカウントを作成する（または既存のワークスペースを使う）

アカウント作成中に GitHub 連携・メンバー招待・メール通知の設定画面が表示されますが、**すべてスキップ（「I'll do this later」）して問題ありません**。後からいつでも設定できます。

2. Settings → 左メニューの「Account」→「Security & Access」→ Personal API keys で新しいキーを作成する

> 「Settings → API」で見つからない場合は、画面左メニューの「Account」セクションの下にある「Security & Access」を探してください。

**APIキーは作成時の一度だけ表示されます。** コピーし忘れて画面を閉じてしまった場合は、古いキーを削除して新しく作り直せば大丈夫です。

3. `.env` ファイルを作成し、キーを設定する

```bash
cp .env.example .env
```

`.env` を開いて以下を設定:

```
MAGAZINE_LINEAR_API_KEY=lin_api_ここにコピーしたキーを貼る
MAGAZINE_LINEAR_TEAM_KEY=あなたのチームキー
```

`MAGAZINE_LINEAR_TEAM_KEY` は Linear のチーム設定画面の URL に含まれるキー（例: `MYTEAM`）です。

**チェックポイント**: 以下のコマンドでデータが取得できることを確認:

```bash
node scripts/fetch-data.js
```

`data/linear-data.json` にデータが保存されれば成功です。

:::info Linear のラベル設定
このツールは Linear のラベルグループを使って進捗を判定します。初期設定では「マガジン作成ステータス（イシュー）」というラベルグループを参照します。自分のプロジェクトに合わせて `config/settings.js` のラベル名を変更してください。
:::

### Part C: Gemini API キーを取得する

Gemini は Google の AI です。健康度データから改善提案を自動生成します。APIキーの発行は [Google AI Studio](https://aistudio.google.com/) という管理画面で行います（Gemini を直接使うのではなく、API キーだけをここで取得します）。

Google アカウントが必要です。持っていない場合は先に作成してください。

1. [Google AI Studio](https://aistudio.google.com/) にアクセスする
2. 「Get API key」→「Create API key」でキーを作成する（既にキーがある場合はそれを使っても OK）
3. `.env` に追記する

```
MAGAZINE_GEMINI_API_KEY=ここにコピーしたキーを貼る
```

**チェックポイント**: 以下のコマンドで提案が生成されることを確認:

```bash
npm run calculate-health
npm run ai-suggestions
```

「生成されたAI提案」が3件表示されれば成功です。Gemini API が使えない場合も、フォールバック機能で提案は自動生成されます。

### Part D: Slack Bot を作成する

Slack にダッシュボードの画像を投稿するための Bot を作ります。

Slack アカウントとワークスペースを持っていない場合は、先に [Slack](https://slack.com/) でワークスペースを作成してください。

1. [Slack API](https://api.slack.com/apps) にアクセスし「Create New App」→「From scratch」
2. 左メニューの「OAuth & Permissions」を開き、「Scopes」セクションまでスクロールする
3. 「Bot Token Scopes」の「Add an OAuth Scope」ボタンをクリックし、検索ボックスに入力して以下の2つを追加する:
   - `chat:write`
   - `files:write`
4. ページ上部の「Install to Workspace」（または左メニューの「Install App」）をクリックしてインストールする
5. インストール後に表示される「Bot User OAuth Token」（`xoxb-` で始まる文字列）をコピーする

> トークンが見つからない場合は、左メニューの「OAuth & Permissions」を開くと「OAuth Tokens for Your Workspace」セクションに表示されています。

6. 投稿先チャンネルで `/invite @あなたのBot名` を実行
7. チャンネル ID を取得（チャンネル名を右クリック → 「チャンネル詳細を表示」の最下部）
8. `.env` に追記する

```
MAGAZINE_SLACK_BOT_TOKEN=xoxb-ここにトークンを貼る
MAGAZINE_SLACK_CHANNEL_ID=C0ここにチャンネルIDを貼る
```

### Part E: Surge アカウントを準備する

Surge はHTMLを無料で公開できるサービスです。ダッシュボードをウェブで見られるようにします。

1. 以下のコマンドでアカウントを作成する

```bash
npx surge login
```

メールアドレスとパスワードの入力を求められます。**初回はアカウントが自動作成されます。** 既存のアカウントにログインするのではなく、好きなパスワードを新しく設定してください。

> **ターミナルでのパスワード入力について**: パスワードを入力しても画面には何も表示されません（`****` も出ません）。これはセキュリティ上の仕様です。そのまま入力してEnterを押せば反映されます。

2. トークンを取得する

```bash
npx surge token
```

3. `.env` に追記する

```
MAGAZINE_SURGE_LOGIN=あなたのメールアドレス
MAGAZINE_SURGE_TOKEN=ここにトークンを貼る
MAGAZINE_SURGE_DOMAIN=あなたのプロジェクト名-dashboard.surge.sh
```

`MAGAZINE_SURGE_DOMAIN` は好きな名前を設定できます（例: `my-team-dashboard.surge.sh`）。

### Part F: 動作確認

すべての環境変数が設定できたら、動作確認に進みます。

まず、スクリーンショット撮影に必要な Playwright のブラウザをインストールします:

```bash
npx playwright install chromium
```

次に、全パイプラインを実行します:

```bash
npm run run-all
```

成功すると:
- `output/dashboard.html` にダッシュボードが生成される
- Surge にデプロイされてブラウザで見られる
- Slack にスクリーンショット3枚が投稿される

ここまでで手動実行は完了です。毎朝自動でダッシュボードを更新してSlackに届くようにしたい場合は、次の「自動実行の設定（GitHub Actions）」に進んでください。

---

## 自動実行の設定（GitHub Actions）

GitHub Actions を使うと、毎朝自動でダッシュボードを更新してSlackに投稿できます。手動で毎朝コマンドを打つ必要がなくなります。

GitHub アカウントを持っていない場合は、先に [GitHub](https://github.com/) でアカウントを作成してください。

### 設定手順

1. GitHub にリポジトリを作成し、コードをプッシュする

Gitea からクローンした場合、GitHub は別のリモートとして追加します。AIに「このリポジトリを GitHub にもプッシュしたい」と相談すれば手順を案内してもらえます。

> **`npm ci` のエラーについて**: GitHub Actions のワークフローは `npm ci` を使って依存関係をインストールします。`package-lock.json` がコミットされていないと失敗するので、プッシュ前に `package-lock.json` が含まれていることを確認してください。

2. Settings → Secrets and variables → Actions で以下のシークレットを追加:

| シークレット名 | 値 |
|---|---|
| `MAGAZINE_LINEAR_API_KEY` | Linear API キー |
| `MAGAZINE_LINEAR_TEAM_KEY` | Linear チームキー |
| `MAGAZINE_GEMINI_API_KEY` | Gemini API キー |
| `MAGAZINE_SLACK_BOT_TOKEN` | Slack Bot トークン |
| `MAGAZINE_SLACK_CHANNEL_ID` | Slack チャンネル ID |
| `MAGAZINE_SURGE_LOGIN` | Surge メールアドレス |
| `MAGAZINE_SURGE_TOKEN` | Surge トークン |
| `MAGAZINE_SURGE_DOMAIN` | Surge ドメイン |

3. `.github/workflows/run-dashboard.yml` の `schedule` 行のコメントを外す

```yaml
  schedule:
    - cron: '0 0 * * 1-5'  # 毎朝9時（JST）、平日のみ
```

4. Actions タブで「ダッシュボード更新」を手動実行して動作を確認する

:::info 企画案ストック判定の制限
GitHub Actions では実行ごとにワークスペースがリセットされるため、企画案ストックの週次判定は正確に機能しません（毎回初回扱いになります）。正確な判定が必要な場合は、`data/stock-tracker.json` を永続化する設計を追加してください。
:::

---

## カスタマイズの手順

### Linear のラベル構造を変更する

`config/settings.js` を開いて、あなたの Linear ワークスペースのラベル名に合わせて変更してください。

```javascript
export const LABEL_GROUPS = {
  parentStatus: 'あなたのラベルグループ名',
  subIssueStatus: 'あなたのサブイシューラベルグループ名',
};

export const STATUS_LABELS = {
  stock: '1.企画案ストック',      // あなたのラベル名に変更
  composition: '2.構成作成中',    // あなたのラベル名に変更
  manuscript: '3.原稿執筆中',     // あなたのラベル名に変更
  video: '4.動画編集中',          // あなたのラベル名に変更
};
```

### 担当者名を変更する

`config/mappings.js` の `ASSIGNEE_MAPPINGS_INCLUDE` と `ASSIGNEE_MAPPINGS_STARTS_WITH` を編集して、チームメンバーの Linear ユーザー名と表示名の対応を設定してください。

### 健康度の閾値を調整する

`config/health-thresholds.yaml` を編集します。コードを変更する必要はありません。

```yaml
stock:
  healthy: 8      # ≥8本で順調（🟢）
  warning: 5      # 5-7本で注意（🟡）
delay:
  healthy: 0      # 遅延なしで順調
  warning: 1      # 1日遅延で注意
```

### AI提案のプロンプトを調整する

`config/ai-prompts/unified.md` を編集します。`{{CONTEXT}}` の部分に健康度データが自動で挿入されます。

### 見た目（CSS）を変更する

`config/dashboard-styles.css` を編集します。ダッシュボードのデザインを自由に変更できます。

---

## 仕組みの解説

このツールは7つのスクリプトがパイプラインとして順番に実行されます。

```
npm run run-all

  ① fetch-data         Linear API からタスクデータを取得 → data/linear-data.json
  ② calculate-health   健康度を計算                      → data/health-data.json
  ③ ai-suggestions     Gemini で改善提案を生成            → data/ai-suggestions.json
  ④ generate-dashboard HTML ダッシュボードを組み立て       → output/dashboard.html
  ⑤ deploy             Surge にデプロイ                   → data/deployed-url.txt
  ⑥ screenshot         Playwright でスクリーンショット     → output/screenshot-*.png
  ⑦ post-slack         Slack に画像とサマリーを投稿
```

各スクリプトは独立しており、個別に実行できます:

```bash
npm run fetch-data          # ①だけ実行
npm run calculate-health    # ②だけ実行
npm run ai-suggestions      # ③だけ実行
npm run generate-dashboard  # ④だけ実行
npm run deploy              # ⑤だけ実行
npm run screenshot          # ⑥だけ実行
npm run post-slack          # ⑦だけ実行
```

### 設定ファイルの役割

| ファイル | 役割 |
|---|---|
| `config/settings.js` | Linear のチームキー・ラベル名など、プロジェクト固有の設定 |
| `config/mappings.js` | 担当者名の変換ルール |
| `config/health-thresholds.yaml` | 健康度判定の閾値（コード変更不要で調整可能） |
| `config/ai-prompts/unified.md` | AI提案生成のプロンプト |
| `config/dashboard-styles.css` | ダッシュボードの見た目 |

---

## セキュリティについて

- `.env` ファイルには API キーやトークンが含まれます。**Git にコミットしてはいけません**
- `.gitignore` で `.env` は除外済みです
- `.env.example` はキーの形式だけを示したテンプレートで、実際のキーは含まれていません

**⚠️ API キーやパスワードを AI チャットに貼り付けないでください。** Cursor のチャットやその他の AI ツールに API キーを送ると、外部サーバーに送信される可能性があります。キーの設定は `.env` ファイルへの直接入力で行い、チャット欄には貼らないようにしてください。

---

## Todoレポート自動配信（メール向け）

業務ごとのTodo一覧を、毎週月曜8:00に自動配信する専用パイプラインを追加しています。見本レイアウトに近い `output/todo-report.html` を生成し、Surge URLをメールで送信します。

仕組みと運用フローの図解: [`docs/todo-automation-diagram.html`](docs/todo-automation-diagram.html)

### 入力データ

`data/todo-sources/` の4ファイルを入力ソースとして使います。

- `mail-todos.json`（メール由来）
- `meeting-log-todos.json`（打合せ記録簿由来）
- `phone-log-todos.json`（電話連絡由来）
- `business-events.json`（検討委員会・文化庁協議の実施記録）

### Apple カレンダー（iCal）からの自動取り込み

手編集の代わりに、**macOS の「カレンダー」**または **エクスポートした `.ics`** から `business-events.json` を更新できます。

1. `config/apple-calendar-sync.example.json` を `config/apple-calendar-sync.json` にコピーし、`calendars` に読み取り対象のカレンダー名（カレンダー.appに表示される名前と同一）、`businessNames` に業務ID→正式名称を書きます。
2. **カレンダー上の予定タイトル**は、次のいずれかで構いません（負荷を減らすなら **A** か **B** がおすすめです）。  
   - **A（おすすめ）— `calendarFallback`**  
     `apple-calendar-sync.json` に `"calendarFallback": { "カレンダー名（calendars と一致）": { "businessId": "20260141", "eventType": "bunkacho_consultation" } }` を書くと、そのカレンダー内の予定は **タイトルを自由入力**でよく、業務番号・角括弧は不要です（**1カレンダー＝1業務・1種別**のとき向き）。  
   - **B — メモ欄にだけ書く**  
     タイトルは普通の文章でよく、予定の **メモ（説明）の先頭に**次の2行を書きます。  
     `bid:20260141`（業務ID。**2026始まりなら省略可**: `bid:60141` / `bid:0141` / `bid:141` も `20260141` に展開）  
     `type:文化庁協議`（`eventTypeMap` にあるキー、または `kickoff_meeting` / `review_committee` / `bunkacho_consultation` をそのまま）  
     `.ics` 取り込み時はカレンダー名が `ics` になるため、フォールバックは `"calendarFallback": { "ics": { "businessId": "...", "eventType": "..." } }` のようにキー `ics` で指定できます（中身が単一業務に限られる場合向け）。  
   - **C — 従来どおりタイトルに番号で書く**  
     `[業務ID][種別キーワード] 表示名`  
     例: `[20260132][kickoff] 初回打合せ`  
     種別は `eventTypeMap` にあるキーへマップされます（例: `kickoff` → `kickoff_meeting`、`検討委` → `review_committee`）。
   - **D — 市町村名・遺跡名 + 区切り + 種別（業務番号なし）**  
     `titleKeywordSeparator`（既定 `_`）でつなぎ、左側を `titleKeywordAliases`（または `config/todo-report-settings.js` の `BUSINESS_NAME_ALIASES` を `useSettingsKeywordAliases` で併用）に登録したキーワードと照合します。  
     例: `四條畷市_文化庁協議`、`舟木遺跡_初回打合せ`  
     開始時刻をタイトルに含める場合は末尾に **`_HHMM`（24時間・4桁）** を足せます。例: `四條畷市_文化庁協議_1300`、`舟木遺跡_初回打合せ_0930`。種別の判定では末尾の `_1300` などは自動ではずれ、`eventTypeMap` には `文化庁協議` / `初回打合せ` 側だけが使われます（カレンダーに表示しているタイトル全文がイベント名として残ります）。**レポートの「開催日時」には、この `_HHMM` を東京の同一日付に反映します**（終日予定で **00:00** と出るのは、内部ではその日の始めの瞬間になっているため。**`_1300` を付けて同期すると開催時刻に置き換わります**。終日に `_HHMM` が無い場合はカレンダー側の開始時刻のままです）。区切りは半角 `_` を推奨（全角 `＿` は同期時に半角へそろえます）。無効な時刻（例 `_2560`）は時刻扱いしません。無効にしたいときは `applyTitleHmToEventDate`: false。
3. **キックオフの客先資料期限**を別途入れたい場合は、予定の **メモ（説明）の1行目**に  
   `clientDue:2026-05-20T18:00:00+09:00`  
   のように書きます（省略可）。
4. **Mac 上**で `npm run sync-business-events-calendar` を実行すると、Calendar.app から指定期間のイベントを取得し、既存の手動登録（`eventId` が `ical-` で始まらない行）は残したままマージします。
5. **GitHub Actions（Linux）や Mac を常時オンにしない場合**は Calendar.app が使えません。次のいずれかです。  
   - **（おすすめ）ICS の URL — `TODO_REPORT_BUSINESS_EVENTS_ICS_URL`**  
     iCloud／Apple カレンダーで対象カレンダーを **共有（公開URL・購読リンク）** し、発行された `webcal://…` または `https://…` を GitHub Secret に登録します（`webcal://` は実行時に `https://` に読み替えます）。週次ワークフローが **その URL から .ics を取得**して `business-events.json` を更新するため、**Mac がオフでも巡回できます**。  
   - **リポジトリ内の `.ics`** — 書き出したファイルをコミットし、`TODO_REPORT_BUSINESS_EVENTS_ICS_PATH` でパス指定する。  
   - **手動 JSON** — Mac で一度 `sync-business-events-calendar` した `data/todo-sources/business-events.json` をコミットする。

初回のみ、**システム設定 → プライバシーとセキュリティ → 自動化** で、ターミナル（または Runner）が「カレンダー」を操作できるように許可が必要な場合があります。

`run-todo-report` 系のパイプラインでは、`build-todo-report-data` の直前に `sync-business-events-calendar` が走ります（設定ファイルが無い場合は何もしません）。

電話連絡は自動取得が難しいため、フォーム入力や定型メモ連携で `phone-log-todos.json` に集約する前提です。

フォーム連携時は、CSV出力を `data/todo-sources/raw-phone-log.csv` と同じヘッダー形式にそろえて取り込みます。  
`TODO_REPORT_PHONE_LOG_CSV_URL` を設定すると、`npm run sync-phone-log` でURLからCSVを自動同期できます（Googleスプレッドシート公開CSV URLなど）。

打合せ簿を会社の Dropbox に置く場合は、`TODO_REPORT_DROPBOX_MEETING_PATH` と認証情報を設定すると `npm run sync-meeting-docs-dropbox`（`run-todo-report` に組込み済み）で GitHub Actions からも取得できます。認証は `TODO_REPORT_DROPBOX_ACCESS_TOKEN`（従来）または `TODO_REPORT_DROPBOX_APP_KEY` / `TODO_REPORT_DROPBOX_APP_SECRET` / `TODO_REPORT_DROPBOX_REFRESH_TOKEN`（推奨: 毎回再取得）です。詳細は `data/todo-input/README.md` を参照してください。

### ルーティンタスク自動生成

`business-events.json` で会議実施を検知したら、以下を必ず追加します（期限は実施日 + 7日）。

- 議事録作成
- 指摘事項リスト作成

担当者は `config/todo-report-settings.js` の業務IDごとの固定担当者マスタで自動補完します。

### 実行コマンド

```bash
npm run run-todo-report
```

このコマンドは先に `npm run sync-phone-log` と `npm run import-phone-log` を実行し、電話連絡CSVを取り込んでからレポート生成に進みます。

事前チェックだけ実行したい場合:

```bash
npm run check-todo-report-setup
```

本番前にローカルで安全確認（メールdry-run / デプロイなし）:

```bash
npm run run-todo-report:preview
```

個別実行:

```bash
npm run sync-phone-log
npm run import-phone-log
npm run build-todo-report-data
npm run generate-todo-report
npm run deploy-todo-report
npm run send-todo-report-email
```

メール送信のドライラン:

```bash
npm run send-todo-report-email:dry-run
```

### 必要な環境変数（メール送信）

`.env.example` の「Todoレポート自動配信」ブロックを参照してください。

GitHub Actions では `.github/workflows/run-todo-report.yml` が毎週月曜8:00（JST）に実行されます。

### GitHub Secrets 設定（最短）

GitHub の `Settings -> Secrets and variables -> Actions` で以下を追加してください。

必須（本番配信）:

- `TODO_REPORT_SMTP_HOST`
- `TODO_REPORT_SMTP_PORT`
- `TODO_REPORT_SMTP_USER`
- `TODO_REPORT_SMTP_PASS`
- `TODO_REPORT_MAIL_FROM`
- `TODO_REPORT_MAIL_TO`

推奨:

- `TODO_REPORT_PHONE_LOG_CSV_URL`（Googleフォーム回答CSVの公開URL）
- `TODO_REPORT_BUSINESS_EVENTS_ICS_URL`（カレンダーの .ics 購読 URL。Mac オフで GitHub Actions から取り込み可。`config/apple-calendar-sync.json` はリポジトリに含める）
- `TODO_REPORT_DROPBOX_MEETING_PATH`（打合せ簿を Dropbox から同期する場合のフォルダパス）
- `TODO_REPORT_DROPBOX_APP_KEY` / `TODO_REPORT_DROPBOX_APP_SECRET` / `TODO_REPORT_DROPBOX_REFRESH_TOKEN`（推奨。毎回 access token を再取得）
- `TODO_REPORT_DROPBOX_ACCESS_TOKEN`（従来方式。期限切れ時は更新が必要）
- `TODO_REPORT_SURGE_DOMAIN`
- `TODO_REPORT_SURGE_LOGIN`
- `TODO_REPORT_SURGE_TOKEN`
- `TODO_REPORT_PUBLIC_URL`
- `TODO_REPORT_FAIL_ON_WARNINGS`（`1` で警告時に失敗）

メール巡回（IMAP。`run-todo-report` 内の `fetch-todo-mails:imap` 用。ローカルの `.env` と同じ値を登録）:

- `TODO_REPORT_MAIL_IMAP_HOST`
- `TODO_REPORT_MAIL_IMAP_PORT`（例: `993`）
- `TODO_REPORT_MAIL_IMAP_SECURE`（例: `1`）
- `TODO_REPORT_MAIL_IMAP_USER`
- `TODO_REPORT_MAIL_IMAP_PASS`
- `TODO_REPORT_MAIL_IMAP_MAILBOX`（省略時は多くの環境で `INBOX`）
- `TODO_REPORT_MAIL_IMAP_FETCH_LIMIT`（任意）
- `TODO_REPORT_MAIL_IMAP_LOOKBACK_DAYS`（任意）

Surge のログインが別キーのときは、ワークフローが参照する `MAGAZINE_SURGE_LOGIN` / `MAGAZINE_SURGE_TOKEN` / `MAGAZINE_SURGE_DOMAIN` も設定してください。

まずは `Actions -> Todoレポート自動配信 -> Run workflow` で `mode=preview` を実行し、問題なければ `mode=production` で確認する運用が安全です。

### Googleフォーム連携を確実に通す手順

1. Googleフォームの回答先を Googleスプレッドシートに連携  
2. 回答シートのヘッダーを以下にそろえる（この順推奨）
   - `businessId,businessName,status,content,submittedAt,responseDueAt,returnAt,clientDueAt`
3. シートを公開し、CSV URL を作成（`.../export?format=csv&gid=...`）
4. URLを `TODO_REPORT_PHONE_LOG_CSV_URL` に設定
5. ローカルで検証:

```bash
npm run check-phone-log-source
```

6. 問題なければ preview 実行:

```bash
npm run run-todo-report:preview
```

### 連携トラブル時の切り分け

- `CSV取得失敗: 403/404`  
  - 共有設定（リンクを知っている全員）またはURLの `gid` を確認
- `CSVヘッダー不足`  
  - フォーム回答シートの列名を README の必須ヘッダーに合わせる
- データ行数 0件  
  - 回答が未入力、または別シートを `gid` で指定している可能性

### データ品質チェック

`build-todo-report-data` 実行時に、以下の期限整合性を自動チェックします。

- 返答期日 <= 客先提出期限
- 戻し日程 <= 客先提出期限
- 最終確認提出 <= 客先提出期限

警告がある場合は、HTMLレポートとメール本文に件数/内容が表示されます。

---

## 困ったときは

つまずいたときは、以下の順で相談してください。

1. **AIに聞く** — エラー文やスクリーンショットを貼って質問する
2. **Slackのチームホームチャンネルで相談する** — 「AIにこう聞いたけど解決しなかった」と経緯を添える
3. [**問い合わせフォーム**](https://tayori.com/form/59d283f664136f1bf4525b0a7eef7d3814bcdd72)**から運営に連絡する** — 試したことを一緒に書く

### よくあるトラブル

| 症状 | 対処 |
|---|---|
| `fetch-data.js` でデータが0件 | Linear のラベルグループ名が `settings.js` と一致しているか確認 |
| Gemini API エラー | フォールバック機能が自動で動くので、提案は生成されます |
| Slack `not_in_channel` | 投稿先チャンネルで `/invite @あなたのBot名` を実行 |
| Surge デプロイ失敗 | `npx surge login` でログイン状態を確認 |
| スクリーンショットが真っ白 | `npx playwright install chromium` を実行 |

:::info 環境制約がある場合
会社のSlackにBot追加不可、APIキーが取れないなどの制約がある場合は、ソース元をJSONファイルに変えてローカルで動かすこともできます。AIに「Linear API を使わずにサンプルデータで動かしたい」と相談してみてください。
:::
