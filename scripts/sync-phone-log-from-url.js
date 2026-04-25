#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'raw-phone-log.csv');

async function syncPhoneLogFromUrl() {
  const csvUrl = process.env.TODO_REPORT_PHONE_LOG_CSV_URL;

  if (!csvUrl) {
    console.log('ℹ️ TODO_REPORT_PHONE_LOG_CSV_URL 未設定のため同期をスキップしました');
    return false;
  }

  console.log('🌐 電話連絡CSVをURLから同期中...');

  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`CSV取得に失敗しました: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  if (!csv.trim()) {
    throw new Error('CSV内容が空です');
  }

  await fs.writeFile(OUTPUT_PATH, csv, 'utf-8');
  console.log(`✅ ${OUTPUT_PATH} を更新しました`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncPhoneLogFromUrl().catch(error => {
    console.error('❌ 電話連絡CSV同期エラー:', error.message);
    process.exit(1);
  });
}

export default syncPhoneLogFromUrl;
