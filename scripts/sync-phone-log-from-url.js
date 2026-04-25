#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'raw-phone-log.csv');

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

function extractHeaderLine(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    return '';
  }
  return lines[0];
}

function validateCsvHeaders(csvText) {
  const headerLine = extractHeaderLine(csvText);
  if (!headerLine) {
    return { ok: false, reason: 'CSVが空です' };
  }

  const firstLineLower = headerLine.toLowerCase();
  if (firstLineLower.includes('<!doctype html') || firstLineLower.includes('<html')) {
    return { ok: false, reason: 'HTMLが返ってきました（共有設定/URLが原因の可能性）' };
  }

  const headers = parseCsvLine(headerLine);
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missing.length > 0) {
    return { ok: false, reason: `CSVヘッダー不足: ${missing.join(', ')}` };
  }

  return { ok: true };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function syncPhoneLogFromUrl() {
  const csvUrl = process.env.TODO_REPORT_PHONE_LOG_CSV_URL;

  if (!csvUrl) {
    console.log('ℹ️ TODO_REPORT_PHONE_LOG_CSV_URL 未設定のため同期をスキップしました');
    return false;
  }

  console.log('🌐 電話連絡CSVをURLから同期中...');

  try {
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`CSV取得に失敗しました: ${response.status} ${response.statusText}`);
    }

    const csv = await response.text();
    if (!csv.trim()) {
      throw new Error('CSV内容が空です');
    }

    const validation = validateCsvHeaders(csv);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    await fs.writeFile(OUTPUT_PATH, csv, 'utf-8');
    console.log(`✅ ${OUTPUT_PATH} を更新しました`);
    return true;
  } catch (error) {
    const hasLocal = await fileExists(OUTPUT_PATH);
    if (hasLocal) {
      console.warn(`⚠️ 電話連絡CSVの同期に失敗しましたが、既存ファイルで続行します: ${error.message}`);
      return false;
    }

    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncPhoneLogFromUrl().catch(error => {
    console.error('❌ 電話連絡CSV同期エラー:', error.message);
    process.exit(1);
  });
}

export default syncPhoneLogFromUrl;
