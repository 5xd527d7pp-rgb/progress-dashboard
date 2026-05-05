#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { REPORT_TIMEZONE } from '../config/todo-report-settings.js';
import { isPhoneOnlyTodoReport } from './todo-report-source-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatDateTime(value) {
  if (!value) return '要確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '要確認';
  return date.toLocaleString('ja-JP', {
    timeZone: REPORT_TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatDate(value) {
  if (!value) return '要確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '要確認';
  return date.toLocaleDateString('ja-JP', {
    timeZone: REPORT_TIMEZONE,
    month: 'long',
    day: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sortTasksByResponseDue(tasks) {
  return [...tasks].sort((a, b) => {
    const aTime = new Date(a.responseDueAt || 0).getTime();
    const bTime = new Date(b.responseDueAt || 0).getTime();
    const aBad = Number.isNaN(aTime);
    const bBad = Number.isNaN(bTime);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return aTime - bTime;
  });
}

/** レポート内の業務IDをソートして安定した biz-tone-0..7 を割り当てる */
const BUSINESS_TONE_MOD = 8;

function makeBusinessToneClassFn(reportData) {
  const ids = new Set();
  for (const b of reportData.businesses || []) {
    if (b.businessId != null && b.businessId !== '') ids.add(String(b.businessId));
  }
  for (const t of reportData.ledger || []) {
    if (t.businessId != null && t.businessId !== '') ids.add(String(t.businessId));
  }
  const sorted = [...ids].sort();
  const map = new Map(sorted.map((id, i) => [id, i % BUSINESS_TONE_MOD]));
  return businessId => {
    const key = String(businessId ?? '');
    if (map.has(key)) return `biz-tone-${map.get(key)}`;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return `biz-tone-${h % BUSINESS_TONE_MOD}`;
  };
}

/** 古い todo-report-data.json でも HTML 上は電話由来だけに揃える */
function applyPhoneOnlyReportData(reportData) {
  if (!isPhoneOnlyTodoReport()) return;

  const ledgerSrc = reportData.ledger || [];
  const phoneLedger = sortTasksByResponseDue(
    ledgerSrc.filter(t => t.sourceType === 'phone')
  );
  reportData.ledger = phoneLedger;

  const businesses = (reportData.businesses || [])
    .map(b => ({
      ...b,
      events: [],
      latestEvents: {},
      meetingHeldAt: null,
      eventClientDocumentDueAt: null,
      tasks: sortTasksByResponseDue((b.tasks || []).filter(t => t.sourceType === 'phone'))
    }))
    .filter(b => b.tasks.length > 0);
  reportData.businesses = businesses;

  const serialSet = new Set(phoneLedger.map(t => t.serialNo));
  const warnings = (reportData.checks?.warnings || []).filter(
    w => !w.serialNo || serialSet.has(w.serialNo)
  );
  reportData.checks = {
    ...reportData.checks,
    warnings,
    warningCount: warnings.length
  };

  const today = new Date();
  reportData.summary = {
    activeBusinessCount: businesses.length,
    totalTaskCount: phoneLedger.length,
    warningCount: warnings.length,
    dueToSubmitTodayCount: phoneLedger.filter(task => {
      if (!task.submittedAt) return false;
      const submitted = new Date(task.submittedAt);
      if (Number.isNaN(submitted.getTime())) return false;
      return (
        submitted.getFullYear() === today.getFullYear() &&
        submitted.getMonth() === today.getMonth() &&
        submitted.getDate() === today.getDate()
      );
    }).length
  };
}

function isCompletedStatus(status) {
  let normalized = String(status ?? '').trim();
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // ignore
  }
  if (!normalized) return false;
  if (normalized.includes('完了')) return true;
  if (normalized.toLowerCase() === 'done') return true;
  return false;
}

function renderBusinessBlock(business, businessToneClass) {
  const latestReview = business.latestEvents?.review_committee;
  const latestBunkacho = business.latestEvents?.bunkacho_consultation;
  const latestKickoff = business.latestEvents?.kickoff_meeting;
  const latestEventLabel = latestReview
    ? `直近検討委員会`
    : latestBunkacho
      ? `直近文化庁協議`
      : latestKickoff
        ? `直近会議: ${latestKickoff.eventName || '打合せ'}`
        : '直近会議情報: 未登録';

  const heldIso =
    business.meetingHeldAt ||
    latestReview?.eventDate ||
    latestBunkacho?.eventDate ||
    latestKickoff?.eventDate;
  const heldLabel =
    heldIso && !Number.isNaN(new Date(heldIso).getTime())
      ? `開催日時: ${formatDateTime(heldIso)}`
      : '開催日時: 未登録';

  const taskClientDates = business.tasks
    .map(task => new Date(task.clientDueAt))
    .filter(date => !Number.isNaN(date.getTime()));
  const maxTaskClientDue = taskClientDates.sort((a, b) => b - a)[0];

  const eventClientDue = business.eventClientDocumentDueAt
    ? new Date(business.eventClientDocumentDueAt)
    : null;
  const effectiveClientDue =
    eventClientDue && !Number.isNaN(eventClientDue.getTime())
      ? eventClientDue
      : maxTaskClientDue;

  const clientDueLabel = effectiveClientDue
    ? `客先資料提出期限: ${formatDateTime(effectiveClientDue.toISOString())}`
    : '客先資料提出期限: 未設定';

  const tone = businessToneClass(business.businessId);
  const rows = business.tasks.map(task => {
    const rowClass = [tone, isCompletedStatus(task.status) ? 'task-completed' : '']
      .filter(Boolean)
      .join(' ');
    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(task.serialNo)}</td>
        <td class="status-cell">${escapeHtml(task.status)}</td>
        <td>${escapeHtml(task.assignee)}</td>
        <td class="content-cell">${escapeHtml(task.content)}</td>
        <td>${escapeHtml(task.instructionMethod)}</td>
        <td>${escapeHtml(formatDateTime(task.submittedAt))}</td>
        <td>${escapeHtml(formatDateTime(task.responseDueAt))}</td>
        <td>${escapeHtml(formatDateTime(task.returnAt))}</td>
        <td>${escapeHtml(formatDateTime(task.clientDueAt))}</td>
      </tr>
  `;
  }).join('');

  return `
    <section class="card ${tone}">
      <h3>${escapeHtml(business.businessId)}_${escapeHtml(business.businessName)}</h3>
      <p class="meta">${escapeHtml(latestEventLabel)}　${escapeHtml(heldLabel)}　${escapeHtml(clientDueLabel)}</p>
      <table>
        <thead>
          <tr>
            <th>シリアルNo</th>
            <th>状態</th>
            <th>担当者</th>
            <th>内容（なにを）</th>
            <th>指示方法</th>
            <th>最終確認者へ提出</th>
            <th>返答期日</th>
            <th>戻し日程</th>
            <th>客先提出期限</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

async function generateTodoReport() {
  console.log('📝 TodoレポートHTMLを生成中...');

  const dataPath = path.join(__dirname, '..', 'data', 'todo-report-data.json');
  const outputPath = path.join(__dirname, '..', 'output', 'todo-report.html');

  const reportData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
  applyPhoneOnlyReportData(reportData);

  const htmlBuildIso = new Date().toISOString();
  const generatedAt = new Date(reportData.generatedAt).toLocaleString('ja-JP', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const periodStart = new Date(reportData.reportPeriod.startAt).toLocaleDateString('ja-JP', {
    timeZone: REPORT_TIMEZONE
  });
  const periodEnd = new Date(reportData.reportPeriod.endAt).toLocaleDateString('ja-JP', {
    timeZone: REPORT_TIMEZONE
  });

  const businessToneClass = makeBusinessToneClassFn(reportData);
  const businessBlocks = reportData.businesses
    .map(b => renderBusinessBlock(b, businessToneClass))
    .join('');
  const warnings = reportData.checks?.warnings || [];

  const ledgerRows = reportData.ledger
    .map(task => {
      const tone = businessToneClass(task.businessId);
      const rowClass = [tone, isCompletedStatus(task.status) ? 'task-completed' : '']
        .filter(Boolean)
        .join(' ');
      return `
      <tr class="${rowClass}">
        <td>${escapeHtml(task.serialNo)}</td>
        <td>${escapeHtml(task.businessName)}</td>
        <td class="status-cell">${escapeHtml(task.status)}</td>
        <td>${escapeHtml(task.assignee)}</td>
        <td class="content-cell">${escapeHtml(task.content)}</td>
        <td>${escapeHtml(task.instructionMethod)}</td>
        <td>${escapeHtml(formatDateTime(task.submittedAt))}</td>
        <td>${escapeHtml(formatDateTime(task.responseDueAt))}</td>
        <td>${escapeHtml(formatDateTime(task.returnAt))}</td>
        <td>${escapeHtml(formatDateTime(task.clientDueAt))}</td>
      </tr>
  `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <title>業務Todoレポート</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f8fa; color: #1f2328; }
    main { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { margin-bottom: 8px; }
    .meta { color: #59636e; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
    .summary .item { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px; }
    .summary .item strong { display: block; font-size: 1.6rem; }
    .card { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #d8dee4; padding: 8px; text-align: left; white-space: nowrap; }
    .content-cell {
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      min-width: 300px;
      max-width: 520px;
    }
    th { background: #f6f8fa; }
    table.ledger td:nth-child(2) {
      white-space: normal;
      max-width: 22em;
    }
    ul { margin-top: 0; }
    .footer-note { color: #59636e; font-size: 13px; }
    .warning-list li { color: #9a3412; }
    tr.task-completed td {
      color: #6e7781 !important;
      background: #f0f3f6 !important;
      text-decoration: line-through;
    }
    tr.task-completed .status-cell {
      text-decoration: none !important;
      font-weight: 600;
    }
    /* 業務IDごとの薄色（同じ業務は同じトーン） */
    section.card.biz-tone-0 { background: #f7fbff; border-left: 4px solid #7eb0e0; }
    section.card.biz-tone-1 { background: #f8f6ff; border-left: 4px solid #a090e0; }
    section.card.biz-tone-2 { background: #f4fbf7; border-left: 4px solid #6ec4a0; }
    section.card.biz-tone-3 { background: #fffcf5; border-left: 4px solid #e0b060; }
    section.card.biz-tone-4 { background: #fbfef3; border-left: 4px solid #a8c850; }
    section.card.biz-tone-5 { background: #fff8f8; border-left: 4px solid #e89898; }
    section.card.biz-tone-6 { background: #f3fcfc; border-left: 4px solid #5ec0c8; }
    section.card.biz-tone-7 { background: #faf8f4; border-left: 4px solid #c8a86c; }
    .card table tbody tr:not(.task-completed).biz-tone-0 td { background-color: #eef5fc; }
    .card table tbody tr:not(.task-completed).biz-tone-1 td { background-color: #f0edfb; }
    .card table tbody tr:not(.task-completed).biz-tone-2 td { background-color: #e8f5ef; }
    .card table tbody tr:not(.task-completed).biz-tone-3 td { background-color: #faf3e6; }
    .card table tbody tr:not(.task-completed).biz-tone-4 td { background-color: #f2f6e8; }
    .card table tbody tr:not(.task-completed).biz-tone-5 td { background-color: #fceff0; }
    .card table tbody tr:not(.task-completed).biz-tone-6 td { background-color: #e8f7f7; }
    .card table tbody tr:not(.task-completed).biz-tone-7 td { background-color: #f3efe6; }
    table.ledger tbody tr:not(.task-completed).biz-tone-0 td { background-color: #eef5fc; }
    table.ledger tbody tr:not(.task-completed).biz-tone-1 td { background-color: #f0edfb; }
    table.ledger tbody tr:not(.task-completed).biz-tone-2 td { background-color: #e8f5ef; }
    table.ledger tbody tr:not(.task-completed).biz-tone-3 td { background-color: #faf3e6; }
    table.ledger tbody tr:not(.task-completed).biz-tone-4 td { background-color: #f2f6e8; }
    table.ledger tbody tr:not(.task-completed).biz-tone-5 td { background-color: #fceff0; }
    table.ledger tbody tr:not(.task-completed).biz-tone-6 td { background-color: #e8f7f7; }
    table.ledger tbody tr:not(.task-completed).biz-tone-7 td { background-color: #f3efe6; }
  </style>
</head>
<body>
  <!-- html-build: ${htmlBuildIso} -->
  <main>
    <p class="meta">WEEKLY TODO REPORT</p>
    <h1>業務進捗レポート（客先提出管理）</h1>
    <p class="meta">対象期間: ${periodStart} - ${periodEnd}</p>
    <p class="meta">作成日時: ${generatedAt}</p>
    <p class="meta">HTMLビルド: ${escapeHtml(htmlBuildIso)}（この行が新しければ Surge まで届いています）</p>
    <p class="meta">レポート作成者: 自動集計ボット</p>

    <section class="summary">
      <div class="item"><span>同時進行中の業務</span><strong>${reportData.summary.activeBusinessCount}件</strong></div>
      <div class="item"><span>全作業タスク数</span><strong>${reportData.summary.totalTaskCount}件</strong></div>
      <div class="item"><span>本日中に最終確認者へ提出</span><strong>${reportData.summary.dueToSubmitTodayCount}件</strong></div>
      <div class="item"><span>期限整合性の警告</span><strong>${reportData.summary.warningCount}件</strong></div>
    </section>

    <h2>業務単位のタスク整理</h2>
    <p class="meta">業務ごとに「会議日・資料提出期限・タスク進行」をまとめて確認</p>
    ${businessBlocks}

    <section class="card">
      <h2>シリアルナンバー管理台帳</h2>
      <p class="meta">返答期日が近い順に表示（業務タスク表に加え業務名列あり）</p>
      <table class="ledger">
        <thead>
          <tr>
            <th>シリアルNo</th>
            <th>業務名</th>
            <th>状態</th>
            <th>担当者</th>
            <th>内容（なにを）</th>
            <th>指示方法</th>
            <th>最終確認者へ提出</th>
            <th>返答期日</th>
            <th>戻し日程</th>
            <th>客先提出期限</th>
          </tr>
        </thead>
        <tbody>
          ${ledgerRows}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>期限整合性チェック結果</h2>
      ${warnings.length === 0
        ? '<p class="meta">警告はありません。</p>'
        : `<ul class="warning-list">${warnings.map(item => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>`
      }
    </section>

    <section class="card">
      <h2>確認ポイント</h2>
      <ul>
        <li>シリアルNo（SN-xxxx）が同一タスクを指しているか</li>
        <li>返答期日/戻し日程が、会議体の資料提出日より前に収まっているか</li>
        <li>客先提出期限より前に、最終確認者への提出が完了する計画か</li>
      </ul>
      <h2>運用メモ</h2>
      <ul class="footer-note">
        <li>このページURLをメール本文に貼り付けて配信する運用を想定</li>
        <li>毎週月曜8:00に自動更新（GitHub ActionsのUTC設定では日曜23:00）</li>
        <li>次フェーズで部署フィルタ/検索/CSV出力を追加予定</li>
      </ul>
    </section>
  </main>
</body>
</html>`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf-8');

  console.log('✅ output/todo-report.html を生成しました');
  return outputPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateTodoReport().catch(error => {
    console.error('❌ Todoレポート生成エラー:', error.message);
    process.exit(1);
  });
}

export default generateTodoReport;
