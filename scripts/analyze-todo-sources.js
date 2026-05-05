#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { simpleParser } from 'mailparser';
import { BUSINESS_NAME_ALIASES, STATUS_LABELS } from '../config/todo-report-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIL_INPUT_DIR = process.env.TODO_REPORT_MAIL_INPUT_DIR
  || path.join(__dirname, '..', 'data', 'todo-input', 'mails');
const MEETING_INPUT_DIR = process.env.TODO_REPORT_MEETING_INPUT_DIR
  || path.join(__dirname, '..', 'data', 'todo-input', 'meeting-docs');
const MAIL_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'mail-todos.json');
const MEETING_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'meeting-log-todos.json');
const MAIL_ANALYZE_SKIP_PATH = process.env.TODO_REPORT_MAIL_ANALYZE_SKIP_PATH
  || path.join(__dirname, '..', 'config', 'todo-mail-analyze-skip.json');
const MAIL_TASK_MAX = Number.parseInt(process.env.TODO_REPORT_MAIL_TASK_MAX || '5', 10);
const MEETING_TASK_MAX = Number.parseInt(process.env.TODO_REPORT_MEETING_TASK_MAX || '25', 10);

function parseTargetArg() {
  const arg = process.argv.find(item => item.startsWith('--target='));
  const value = arg ? arg.split('=')[1] : 'all';
  if (value === 'mail' || value === 'meeting') return value;
  return 'all';
}

function stableHash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function createPseudoBusinessId(seed) {
  const value = parseInt(stableHash(seed).slice(0, 8), 16);
  const n = (value % 90000000) + 10000000;
  return String(n);
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeNameForMatch(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function findBusinessAlias(text) {
  const target = normalizeNameForMatch(text);
  if (!target) return null;
  return BUSINESS_NAME_ALIASES.find(alias =>
    target.includes(normalizeNameForMatch(alias.keyword))
  ) || null;
}

function extractBusinessMeta(text, fallbackName, fallbackIdSeed) {
  const alias = findBusinessAlias(`${text}\n${fallbackName}`);
  if (alias) {
    return {
      businessId: alias.businessId,
      businessName: alias.businessName
    };
  }

  const slashPattern = text.match(/(\d{6,10})\s*\/\s*([^\n]+)/);
  if (slashPattern) {
    return {
      businessId: slashPattern[1],
      businessName: slashPattern[2].trim().slice(0, 120)
    };
  }

  const idPattern = text.match(/(?:業務ID|案件ID|案件番号|businessId)\s*[:：]?\s*(\d{6,10})/i);
  const namePattern = text.match(/(?:業務名|案件名|businessName)\s*[:：]?\s*([^\n]+)/i);
  if (idPattern || namePattern) {
    return {
      businessId: idPattern ? idPattern[1] : createPseudoBusinessId(fallbackIdSeed),
      businessName: namePattern ? namePattern[1].trim().slice(0, 120) : fallbackName
    };
  }

  const numberInName = fallbackName.match(/(\d{6,10})/);
  return {
    businessId: numberInName ? numberInName[1] : createPseudoBusinessId(fallbackIdSeed),
    businessName: fallbackName || `業務${createPseudoBusinessId(fallbackIdSeed)}`
  };
}

function normalizeDateToken(token, defaultTime = '09:00:00') {
  if (!token) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  const fullWithTime = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (fullWithTime) {
    const [, y, m, d, hh, mm] = fullWithTime;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${mm}:00+09:00`;
  }

  const ymdSlashOrHyphen = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymdSlashOrHyphen) {
    const [, y, m, d] = ymdSlashOrHyphen;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${defaultTime}+09:00`;
  }

  const compactYmd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactYmd) {
    const [, y, m, d] = compactYmd;
    return `${y}-${m}-${d}T${defaultTime}+09:00`;
  }

  const md = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(md[1]).padStart(2, '0');
    const d = String(md[2]).padStart(2, '0');
    return `${y}-${m}-${d}T${defaultTime}+09:00`;
  }

  return null;
}

function extractDateByLabels(text, labels, defaultTime) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[^\\n\\d]{0,10}(\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?|\\d{8}|\\d{1,2}[/-]\\d{1,2})`, 'i');
    const match = text.match(re);
    const iso = normalizeDateToken(match?.[1], defaultTime);
    if (iso) return iso;
  }
  return null;
}

function minusOneDay(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T15:00:00+09:00`;
}

/** 記録簿本文から年度・西暦年を推定 */
function resolveDocumentYear(fullText) {
  const t = String(fullText || '').normalize('NFKC');
  const reiwa = t.match(/令和\s*(\d{1,2})\s*年度/);
  if (reiwa) return 2018 + parseInt(reiwa[1], 10);
  const western = t.match(/(20\d{2})\s*年度/);
  if (western) return parseInt(western[1], 10);
  return new Date().getFullYear();
}

function isoJstDateParts(year, monthStr, dayStr, time = '18:00:00') {
  const m = String(monthStr).padStart(2, '0');
  const d = String(dayStr).padStart(2, '0');
  return `${year}-${m}-${d}T${time}+09:00`;
}

/**
 * 1行の記録から「客先提出期限」相当の日付を取る（…月…日までに…委託者に提出 等）
 */
function extractMeetingRowClientDue(content, fullText) {
  const year = resolveDocumentYear(`${fullText}\n${content}`);
  const t = String(content).normalize('NFKC');

  const m1 = t.match(/(\d{1,2})月(\d{1,2})日\s*までに[^。]{0,160}委託者に提出/);
  if (m1) return isoJstDateParts(year, m1[1], m1[2]);

  const m2 = t.match(/(\d{1,2})月(\d{1,2})日\s*までに[^。]{0,160}委託者へ[^。]{0,40}(発送|送付)/);
  if (m2) return isoJstDateParts(year, m2[1], m2[2]);

  const m4 = t.match(/(\d{1,2})月(\d{1,2})日の協議会[^。]{0,60}(確定する|素案を)/);
  if (m4) return isoJstDateParts(year, m4[1], m4[2]);

  const m5 = t.match(/(\d{1,2})月(\d{1,2})日\s*までに[^。]{0,120}委託者に入稿/);
  if (m5) return isoJstDateParts(year, m5[1], m5[2]);

  return null;
}

/**
 * 委託者側の作業だけが書かれた行は受託者TODOに含めない（委託者に提出は残す）
 */
function isMeetingLineClientActorOnly(content) {
  const t = String(content).trim().normalize('NFKC');
  if (!t) return true;

  if (/委託者に(提出|入稿|送付|連絡)|委託者へ[^。]{0,40}(発送|送付|資料)/.test(t)) return false;
  if (/受託者は[^。]{0,80}(誘導|参加者|案内|照らし合わせ|執筆|修正|作成)/.test(t)) return false;

  if (/委託者が行った|委託者で行った/.test(t)) return true;
  if (/委託者が[^。]{0,60}(決定する|決める)/.test(t)) return true;
  if (/委託者が進行[^。]{0,20}務める/.test(t)) return true;
  if (/委託者が[^。]{0,80}(開催する|主宰する|実施する)(?!.*受託者は)/.test(t)) return true;
  if (/グループ分け[^。]*委託者が決定/.test(t)) return true;
  if (/以降[^。]*委託者が決定/.test(t)) return true;

  return false;
}

/** 各章の「◯月◯日までに委託者に提出」があるとき、総論の「◯章を執筆する」は重複として除く */
function isMeetingUmbrellaChapterWritingRedundant(allContents, content) {
  const t = String(content).normalize('NFKC');
  if (!/計画書本文のうち[^。]{0,120}執筆する/.test(t)) return false;
  return allContents.some(other => {
    if (other === content) return false;
    const o = String(other).normalize('NFKC');
    return /\d{1,2}月\d{1,2}日までに第\d+章[^。]{0,80}委託者に提出/.test(o);
  });
}

/**
 * 打合せ記録の「既に終了した事項」だけの行（〜した・〜を行った・了承いただいた等）。未対応タスクに含めない。
 * 同じ行に「確認する」「提出する」等の未完了行為が含まれる場合は残す。
 */
function isMeetingLinePastCompletedRecord(content) {
  const t = String(content).trim().normalize('NFKC');
  if (!t) return true;

  /** 「依頼し、了承された」等は調整完了の記録であり、当事者の未対応Todoではない */
  if (/依頼し[^。]{0,40}了承された/.test(t)) return true;

  if (/了承[^。]{0,40}(いただいた|いただきました|くださった)/.test(t)) return true;
  if (/(?:同意|承諾)して[^。]{0,25}(いただいた|いただきました)/.test(t)) return true;

  if (
    /((確認|提出|修正|対応|実施|作成|連絡|送付|依頼|調整|反映|精査|照合|策定|検討|整理|分析|確定|協議|調査)する|見直す|取りまとめる)/.test(
      t
    )
  ) {
    return false;
  }
  if (/双方確認する/.test(t)) return false;

  if (/を(?:行った|おこなった)[。．]?$/.test(t)) return true;

  if (
    /(報告した|提案した|説明した|共有した|示した|紹介した|お願いした|承認した|採択した|合意した|確認した|検討した|整理した|協議した|調整した|実施した|記載した|取りまとめた|周知した|処理した|完了した|議論した|決定した|調査した|作成した|対応した|連絡した|修正した|反映した)(?:[。．]|$)/.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

/** 目的・方針の説明のみで作業指示ではない行 */
function isMeetingLinePurposeDescriptionOnly(content) {
  return /を目的としている/.test(String(content).normalize('NFKC'));
}

/** メール・打合せの抽出行から除外（PDF のページ番号等） */
function isJunkExtractedTaskLine(line) {
  const t = String(line).trim();
  if (t.length < 4) return true;
  if (/^[A-Za-z]{1,6}\/(?:INBOX|Sent|Drafts|Trash|Junk)(?:\b|$)/i.test(t)) return true;
  if (/^--[0-9a-f]{6,}/i.test(t)) return true;
  if (/^Content-(?:Type|Transfer-Encoding|Disposition):/i.test(t)) return true;
  if (/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/i.test(t)) return true;
  if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
  return false;
}

function isJunkMailTaskLine(line) {
  return isJunkExtractedTaskLine(line);
}

/** メール用（狭い）／打合せ記録簿用（広い） */
function lineLooksLikeActionTask(value, sourceType) {
  if (!value || value.length < 4) return false;
  if (sourceType === 'mail') {
    return /(作成|確認|送付|提出|対応|修正|連絡|準備|反映|更新|レビュー|作業)/.test(value);
  }
  return /(作成|確認|送付|提出|対応|修正|連絡|準備|反映|更新|レビュー|作業|報告|実施|調整|依頼|協議|決定|共有|設計|調査|精査|記載|策定|追加|削除|変更|設置|見直し|双方|内線|スケジュール|素案|体制|欄を|計画書|修正し|作成する|確認する|提出する)/.test(
    value
  );
}

function extractTaskContents(text, sourceType) {
  const taskSet = new Set();

  for (const m of text.matchAll(/(?:TODO|ToDo|タスク|対応事項|依頼|Action|課題)\s*[:：]\s*([^\n]+)/gi)) {
    const value = m[1]?.trim();
    if (value && value.length >= 4 && !isJunkExtractedTaskLine(value)) taskSet.add(value.slice(0, 120));
  }

  const lines = text.split('\n').map(line => line.trim());
  for (const line of lines) {
    const bullet = line.match(/^[-*・]\s*(?:\[[ xX]\]\s*)?(.+)$/);
    const value = bullet ? bullet[1].trim() : null;
    if (!value || value.length < 4 || isJunkExtractedTaskLine(value)) continue;
    if (!lineLooksLikeActionTask(value, sourceType)) continue;
    taskSet.add(value.slice(0, 120));
  }

  if (sourceType === 'meeting') {
    for (const line of lines) {
      const arabic = line.match(/^\d{1,2}[\.\)、．]\s*(.+)$/);
      const circled = line.match(/^[（(](?:[\d一二三四五六七八九十]+)[）)]\s*(.+)$/);
      const value = (arabic?.[1] || circled?.[1] || '').trim();
      if (!value || value.length < 4) continue;
      if (!lineLooksLikeActionTask(value, sourceType)) continue;
      taskSet.add(value.slice(0, 120));
    }
  }

  if (taskSet.size === 0 && sourceType !== 'mail') {
    const firstBodyLine = lines.find(line => line.length >= 5 && !line.startsWith('件名:') && !line.startsWith('タイトル:'));
    if (
      firstBodyLine &&
      !isJunkExtractedTaskLine(firstBodyLine) &&
      (sourceType !== 'meeting' || lineLooksLikeActionTask(firstBodyLine, 'meeting'))
    ) {
      taskSet.add(firstBodyLine.slice(0, 120));
    }
  }

  const max = sourceType === 'meeting' ? Math.max(1, MEETING_TASK_MAX) : Math.max(1, MAIL_TASK_MAX);
  return Array.from(taskSet)
    .filter(c => !isJunkExtractedTaskLine(c))
    .slice(0, max);
}

function extractStatus(text) {
  return /(完了|対応済|済み|クローズ|done)/i.test(text)
    ? STATUS_LABELS.completed
    : STATUS_LABELS.inProgress;
}

function simplifyMeetingTaskContent(content) {
  let text = String(content || '').trim().replace(/[。．]+$/g, '');
  if (!text) return text;

  text = text.normalize('NFKC');
  text = text.replace(/するを確認する/g, 'したかを確認する');

  if (text.startsWith('委託者と受託者は、')) {
    text = text.replace(/^委託者と受託者は、/, '').trim();
    if (!text) return '要確認';
    if (/双方確認する$/.test(text)) return text;
    return `${text}を双方確認する`;
  }
  if (text.startsWith('委託者と受託者は')) {
    text = text.replace(/^委託者と受託者は/, '').trim();
    if (!text) return '要確認';
    if (/双方確認する$/.test(text)) return text;
    return `${text}を双方確認する`;
  }

  if (text.startsWith('受託者は、')) {
    return text.replace(/^受託者は、/, '').trim();
  }
  if (text.startsWith('受託者は')) {
    return text.replace(/^受託者は/, '').trim();
  }

  if (text.startsWith('委託者は、')) {
    text = text.replace(/^委託者は、/, '').trim();
    if (!text) return '要確認';
    if (/確認する$/.test(text)) return text;
    if (/する$/.test(text)) return text.replace(/する$/, 'したかを確認する');
    return `${text}を確認する`;
  }
  if (text.startsWith('委託者は')) {
    text = text.replace(/^委託者は/, '').trim();
    if (!text) return '要確認';
    if (/確認する$/.test(text)) return text;
    if (/する$/.test(text)) return text.replace(/する$/, 'したかを確認する');
    return `${text}を確認する`;
  }

  return text;
}

function toSourceItems({ text, sourcePath, sourceType, instructionMethod, emailSubject = '' }) {
  const normalizedBody = normalizeWhitespace(text);
  const combinedForMeta = emailSubject
    ? normalizeWhitespace(`${emailSubject}\n${normalizedBody}`)
    : normalizedBody;
  if (!normalizedBody && !emailSubject) return [];

  const basename = path.basename(sourcePath).replace(path.extname(sourcePath), '');
  const businessMeta = extractBusinessMeta(combinedForMeta, emailSubject || basename, sourcePath);
  let taskContents = extractTaskContents(normalizedBody, sourceType);
  if (sourceType === 'meeting') {
    taskContents = taskContents.filter(c => !isMeetingLineClientActorOnly(c));
    taskContents = taskContents.filter(c => !isMeetingLinePastCompletedRecord(c));
    taskContents = taskContents.filter(c => !isMeetingLinePurposeDescriptionOnly(c));
    taskContents = taskContents.filter(
      c => !isMeetingUmbrellaChapterWritingRedundant(taskContents, c)
    );
  }
  if (taskContents.length === 0) return [];

  const submittedAt = extractDateByLabels(combinedForMeta, ['提出', '送付', '送信', '受信日時', '依頼日時'], '10:00:00');
  const responseDueAtDoc = extractDateByLabels(combinedForMeta, ['返答期日', '対応期限', '期限', '締切', '回答期限'], '17:00:00');
  const returnAtDoc = extractDateByLabels(combinedForMeta, ['戻し日程', '戻し', '返却', 'レビュー戻し'], '15:00:00');
  const clientDueAtDoc = extractDateByLabels(combinedForMeta, ['客先提出期限', '提出期限', '納品期限', '客先期限'], '18:00:00');
  const status = extractStatus(combinedForMeta);

  return taskContents.map((content, index) => {
    const normalizedContent = sourceType === 'meeting'
      ? simplifyMeetingTaskContent(content)
      : content;
    const rowClientDue =
      sourceType === 'meeting'
        ? extractMeetingRowClientDue(normalizedContent, combinedForMeta)
        : null;
    const clientDueAt = rowClientDue || clientDueAtDoc || responseDueAtDoc || null;
    const responseDueAt = responseDueAtDoc || clientDueAt;
    const returnAt = returnAtDoc || minusOneDay(clientDueAt || responseDueAt);
    const fingerprint = stableHash(`${sourcePath}|${content}|${businessMeta.businessId}`);
    return {
      sourceId: `${sourceType}-${fingerprint}-${String(index + 1).padStart(2, '0')}`,
      businessId: businessMeta.businessId,
      businessName: businessMeta.businessName,
      status,
      content: normalizedContent,
      instructionMethod,
      submittedAt: submittedAt || null,
      responseDueAt: responseDueAt || null,
      returnAt: returnAt || null,
      clientDueAt: clientDueAt || null
    };
  });
}

function simpleStripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadMailSkipPatterns() {
  try {
    const raw = await fs.readFile(MAIL_ANALYZE_SKIP_PATH, 'utf-8');
    const j = JSON.parse(raw);
    return {
      subjectContains: Array.isArray(j.subjectContains) ? j.subjectContains.filter(Boolean) : [],
      bodyContains: Array.isArray(j.bodyContains) ? j.bodyContains.filter(Boolean) : []
    };
  } catch {
    return { subjectContains: [], bodyContains: [] };
  }
}

function shouldSkipMailAnalysis(subject, body, patterns) {
  const subj = String(subject || '').normalize('NFKC');
  const bod = String(body || '').normalize('NFKC');
  for (const p of patterns.subjectContains) {
    if (p && subj.includes(String(p).trim().normalize('NFKC'))) return true;
  }
  for (const p of patterns.bodyContains) {
    if (p && bod.includes(String(p).trim())) return true;
  }
  return false;
}

function stripPdfArtifactLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/i.test(l))
    .filter(l => !/^page\s+\d+\s+of\s+\d+$/i.test(l))
    .join('\n');
}

/** 画像のみ PDF 等で日本語本文が取れないとき true（ページ番号だけ等） */
function pdfExtractedTextIsUnusable(text) {
  const withoutWs = String(text).replace(/\s+/g, '');
  if (withoutWs.length < 10) return true;
  if (!/[\u3005-\u30ff\u3400-\u9fff]/.test(text)) return true;
  return false;
}

async function extractPdfText(filePath) {
  const buf = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    let text = stripPdfArtifactLines(result.text || '');
    if (pdfExtractedTextIsUnusable(text)) {
      return '';
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

/**
 * .eml は mailparser で text/html 本文だけ取る（生 RFC822 だと WL/INBOX 等のパスが誤検出される）
 */
async function readSourceForAnalysis(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.eml') {
    const buf = await fs.readFile(filePath);
    const parsed = await simpleParser(buf);
    const rawText = (parsed.text || '').trim();
    const html = String(parsed.html || '').trim();
    const text = rawText || simpleStripHtml(html);
    return { text, subject: (parsed.subject || '').trim() };
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value || '', subject: '' };
  }
  if (ext === '.pdf') {
    const text = await extractPdfText(filePath);
    return { text, subject: '' };
  }
  const text = await fs.readFile(filePath, 'utf-8');
  return { text, subject: '' };
}

async function listFilesRecursive(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }
      return [fullPath];
    }));
    return files.flat();
  } catch {
    return [];
  }
}

async function buildItemsFromDir({ inputDir, sourceType, instructionMethod, exts }) {
  const allFiles = (await listFilesRecursive(inputDir))
    .filter(filePath => !path.basename(filePath).startsWith('~$'))
    .filter(filePath => exts.includes(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const skipMailPatterns = sourceType === 'mail' ? await loadMailSkipPatterns() : null;

  const items = [];
  const skipped = [];

  for (const filePath of allFiles) {
    try {
      const { text, subject } = await readSourceForAnalysis(filePath);
      if (path.extname(filePath).toLowerCase() === '.pdf' && !String(text).trim()) {
        skipped.push({
          filePath,
          reason:
            'PDFに選択可能なテキストがありません（画像スキャンまたはページ番号のみの場合、解析できません。.docxでエクスポートするか、テキスト入りPDFにしてください）'
        });
        continue;
      }
      if (sourceType === 'mail' && shouldSkipMailAnalysis(subject, text, skipMailPatterns)) {
        continue;
      }
      const extracted = toSourceItems({
        text,
        sourcePath: filePath,
        sourceType,
        instructionMethod,
        emailSubject: subject
      });
      items.push(...extracted);
    } catch (error) {
      skipped.push({ filePath, reason: error.message });
    }
  }

  return { items, scannedCount: allFiles.length, skipped };
}

async function writeItems(outputPath, items) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ items }, null, 2), 'utf-8');
}

async function analyzeTodoSources() {
  const target = parseTargetArg();
  console.log(`🔎 Todo解析を開始します（target=${target}）`);

  await fs.mkdir(MAIL_INPUT_DIR, { recursive: true });
  await fs.mkdir(MEETING_INPUT_DIR, { recursive: true });

  if (target === 'mail' || target === 'all') {
    const mailResult = await buildItemsFromDir({
      inputDir: MAIL_INPUT_DIR,
      sourceType: 'mail',
      instructionMethod: 'メール',
      exts: ['.txt', '.md', '.eml']
    });
    await writeItems(MAIL_OUTPUT_PATH, mailResult.items);
    console.log(`✅ mail-todos.json を更新しました: ${mailResult.items.length}件（入力ファイル ${mailResult.scannedCount}件）`);
    if (mailResult.skipped.length > 0) {
      console.warn(`⚠️ メール解析スキップ: ${mailResult.skipped.length}件`);
      mailResult.skipped.slice(0, 5).forEach(item => {
        console.warn(`   - ${item.filePath}: ${item.reason}`);
      });
    }
  }

  if (target === 'meeting' || target === 'all') {
    const meetingResult = await buildItemsFromDir({
      inputDir: MEETING_INPUT_DIR,
      sourceType: 'meeting',
      instructionMethod: '打合せ',
      exts: ['.docx', '.txt', '.md', '.pdf']
    });
    await writeItems(MEETING_OUTPUT_PATH, meetingResult.items);
    console.log(`✅ meeting-log-todos.json を更新しました: ${meetingResult.items.length}件（入力ファイル ${meetingResult.scannedCount}件）`);
    if (meetingResult.skipped.length > 0) {
      console.warn(`⚠️ 打合せ簿解析スキップ: ${meetingResult.skipped.length}件`);
      meetingResult.skipped.slice(0, 5).forEach(item => {
        console.warn(`   - ${item.filePath}: ${item.reason}`);
      });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeTodoSources().catch(error => {
    console.error('❌ Todo解析エラー:', error.message);
    process.exit(1);
  });
}

export default analyzeTodoSources;
