#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import mammoth from 'mammoth';
import { BUSINESS_NAME_ALIASES, STATUS_LABELS } from '../config/todo-report-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIL_INPUT_DIR = process.env.TODO_REPORT_MAIL_INPUT_DIR
  || path.join(__dirname, '..', 'data', 'todo-input', 'mails');
const MEETING_INPUT_DIR = process.env.TODO_REPORT_MEETING_INPUT_DIR
  || path.join(__dirname, '..', 'data', 'todo-input', 'meeting-docs');
const MAIL_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'mail-todos.json');
const MEETING_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'meeting-log-todos.json');

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

function extractTaskContents(text) {
  const taskSet = new Set();

  for (const m of text.matchAll(/(?:TODO|ToDo|タスク|対応事項|依頼|Action|課題)\s*[:：]\s*([^\n]+)/gi)) {
    const value = m[1]?.trim();
    if (value && value.length >= 4) taskSet.add(value.slice(0, 120));
  }

  const lines = text.split('\n').map(line => line.trim());
  for (const line of lines) {
    const bullet = line.match(/^[-*・]\s*(?:\[[ xX]\]\s*)?(.+)$/);
    const value = bullet ? bullet[1].trim() : null;
    if (!value || value.length < 4) continue;
    if (!/(作成|確認|送付|提出|対応|修正|連絡|準備|反映|更新|レビュー|作業)/.test(value)) continue;
    taskSet.add(value.slice(0, 120));
  }

  if (taskSet.size === 0) {
    const firstBodyLine = lines.find(line => line.length >= 5 && !line.startsWith('件名:') && !line.startsWith('タイトル:'));
    if (firstBodyLine) {
      taskSet.add(firstBodyLine.slice(0, 120));
    }
  }

  return Array.from(taskSet).slice(0, 5);
}

function extractStatus(text) {
  return /(完了|対応済|済み|クローズ|done)/i.test(text)
    ? STATUS_LABELS.completed
    : STATUS_LABELS.inProgress;
}

function simplifyMeetingTaskContent(content) {
  let text = String(content || '').trim().replace(/[。．]+$/g, '');
  if (!text) return text;

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
    return `${text}を確認する`;
  }
  if (text.startsWith('委託者は')) {
    text = text.replace(/^委託者は/, '').trim();
    if (!text) return '要確認';
    if (/確認する$/.test(text)) return text;
    return `${text}を確認する`;
  }

  return text;
}

function toSourceItems({ text, sourcePath, sourceType, instructionMethod }) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const basename = path.basename(sourcePath).replace(path.extname(sourcePath), '');
  const businessMeta = extractBusinessMeta(normalized, basename, sourcePath);
  const taskContents = extractTaskContents(normalized);
  if (taskContents.length === 0) return [];

  const submittedAt = extractDateByLabels(normalized, ['提出', '送付', '送信', '受信日時', '依頼日時'], '10:00:00');
  const responseDueAt = extractDateByLabels(normalized, ['返答期日', '対応期限', '期限', '締切', '回答期限'], '17:00:00');
  const returnAt = extractDateByLabels(normalized, ['戻し日程', '戻し', '返却', 'レビュー戻し'], '15:00:00');
  const clientDueAt = extractDateByLabels(normalized, ['客先提出期限', '提出期限', '納品期限', '客先期限'], '18:00:00');
  const status = extractStatus(normalized);

  return taskContents.map((content, index) => {
    const normalizedContent = sourceType === 'meeting'
      ? simplifyMeetingTaskContent(content)
      : content;
    const fingerprint = stableHash(`${sourcePath}|${content}|${businessMeta.businessId}`);
    return {
      sourceId: `${sourceType}-${fingerprint}-${String(index + 1).padStart(2, '0')}`,
      businessId: businessMeta.businessId,
      businessName: businessMeta.businessName,
      status,
      content: normalizedContent,
      instructionMethod,
      submittedAt: submittedAt || null,
      responseDueAt: responseDueAt || clientDueAt || null,
      returnAt: returnAt || minusOneDay(responseDueAt || clientDueAt),
      clientDueAt: clientDueAt || responseDueAt || null
    };
  });
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

async function readSourceText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  return fs.readFile(filePath, 'utf-8');
}

async function buildItemsFromDir({ inputDir, sourceType, instructionMethod, exts }) {
  const allFiles = (await listFilesRecursive(inputDir))
    .filter(filePath => exts.includes(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const items = [];
  const skipped = [];

  for (const filePath of allFiles) {
    try {
      const text = await readSourceText(filePath);
      const extracted = toSourceItems({ text, sourcePath: filePath, sourceType, instructionMethod });
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
      exts: ['.docx', '.txt', '.md']
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
