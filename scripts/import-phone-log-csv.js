#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATUS_LABELS } from '../config/todo-report-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'raw-phone-log.csv');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'phone-log-todos.json');
const REQUIRED_HEADERS = [
  'businessId',
  'businessName',
  'status',
  'content',
  'submittedAt',
  'responseDueAt',
  'returnAt',
  'clientDueAt'
];

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const missingHeaders = REQUIRED_HEADERS.filter(key => !headers.includes(key));
  if (missingHeaders.length > 0) {
    throw new Error(`CSVヘッダー不足: ${missingHeaders.join(', ')}`);
  }

  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((key, index) => {
      row[key] = values[index] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function normalizeStatus(status) {
  if (status === STATUS_LABELS.completed) return STATUS_LABELS.completed;
  return STATUS_LABELS.inProgress;
}

function normalizeIso(value, defaultTime = '09:00:00') {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // 20260515 -> 2026-05-15T09:00:00+09:00
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return `${y}-${m}-${d}T${defaultTime}+09:00`;
  }

  // 2026/05/15 -> 2026-05-15T09:00:00+09:00
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('/').map(n => String(n).padStart(2, '0'));
    return `${y}-${m}-${d}T${defaultTime}+09:00`;
  }

  // 2026-05-15 -> 2026-05-15T09:00:00+09:00
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(n => String(n).padStart(2, '0'));
    return `${y}-${m}-${d}T${defaultTime}+09:00`;
  }

  const normalized = raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return normalized;
}

function buildSourceId(index, submittedAt) {
  const date = submittedAt ? new Date(submittedAt) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `phone-${y}${m}${d}-${String(index + 1).padStart(3, '0')}`;
}

function toTask(row, index) {
  const businessId = String(row.businessId || '').trim();
  const businessName = String(row.businessName || '').trim();
  const content = String(row.content || '').trim();

  if (!businessId || !businessName || !content) {
    return null;
  }

  const submittedAt = normalizeIso(row.submittedAt, '10:00:00');
  const responseDueAt = normalizeIso(row.responseDueAt, '17:00:00');
  const returnAt = normalizeIso(row.returnAt, '15:00:00');
  const clientDueAt = normalizeIso(row.clientDueAt, '18:00:00');

  return {
    sourceId: buildSourceId(index, submittedAt),
    businessId,
    businessName,
    status: normalizeStatus(row.status),
    content,
    instructionMethod: '電話',
    submittedAt,
    responseDueAt,
    returnAt,
    clientDueAt
  };
}

async function importPhoneLogCsv() {
  console.log('📞 電話連絡CSVを取り込み中...');

  const csv = await fs.readFile(INPUT_PATH, 'utf-8');
  const rows = parseCsv(csv);
  const tasks = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const task = toTask(row, index);
    if (task) {
      tasks.push(task);
      return;
    }
    skipped.push({
      row: index + 2,
      reason: 'businessId/businessName/content のいずれかが空'
    });
  });

  const output = { items: tasks };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✅ ${tasks.length}件を phone-log-todos.json に変換しました`);
  if (skipped.length > 0) {
    console.warn(`⚠️ ${skipped.length}件の行をスキップしました`);
    skipped.slice(0, 5).forEach(item => {
      console.warn(`   - row ${item.row}: ${item.reason}`);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importPhoneLogCsv().catch(error => {
    console.error('❌ 電話連絡CSVの取り込みに失敗しました:', error.message);
    process.exit(1);
  });
}

export default importPhoneLogCsv;
