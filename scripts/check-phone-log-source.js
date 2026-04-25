#!/usr/bin/env node

import 'dotenv/config';

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

async function checkPhoneLogSource() {
  const csvUrl = process.env.TODO_REPORT_PHONE_LOG_CSV_URL;
  if (!csvUrl) {
    throw new Error('TODO_REPORT_PHONE_LOG_CSV_URL が未設定です');
  }

  console.log('🌐 電話連絡CSVソースを検証中...');
  console.log(`URL: ${csvUrl}`);

  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(`CSV取得失敗: ${res.status} ${res.statusText}`);
  }

  const body = await res.text();
  const lines = body.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSVにヘッダーまたはデータ行が不足しています');
  }

  const headers = parseCsvLine(lines[0]);
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(`CSVヘッダー不足: ${missing.join(', ')}`);
  }

  const sample = parseCsvLine(lines[1]);
  const rowPreview = headers.reduce((acc, key, idx) => {
    acc[key] = sample[idx] ?? '';
    return acc;
  }, {});

  console.log(`✅ ヘッダー検証OK (${headers.length}列)`);
  console.log(`✅ データ行数: ${lines.length - 1}件`);
  console.log('🔎 先頭行プレビュー:');
  console.log(JSON.stringify(rowPreview, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkPhoneLogSource().catch(error => {
    console.error('❌ 電話連絡CSVソース検証に失敗:', error.message);
    process.exit(1);
  });
}

export default checkPhoneLogSource;
