#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'todo-sources', 'raw-phone-log.csv');

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
