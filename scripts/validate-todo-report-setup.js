#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_ENV_KEYS = [
  'TODO_REPORT_SMTP_HOST',
  'TODO_REPORT_SMTP_PORT',
  'TODO_REPORT_SMTP_USER',
  'TODO_REPORT_SMTP_PASS',
  'TODO_REPORT_MAIL_FROM',
  'TODO_REPORT_MAIL_TO'
];

const REQUIRED_FILES = [
  'data/todo-sources/mail-todos.json',
  'data/todo-sources/meeting-log-todos.json',
  'data/todo-sources/business-events.json',
  'data/todo-sources/raw-phone-log.csv'
];

const OPTIONAL_ENV_KEYS = [
  'TODO_REPORT_PHONE_LOG_CSV_URL',
  'TODO_REPORT_SURGE_DOMAIN',
  'TODO_REPORT_PUBLIC_URL'
];

const REQUIRED_ENV_KEYS_PREVIEW = [];

async function checkFileExists(relativePath) {
  const filePath = path.join(__dirname, '..', relativePath);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateTodoReportSetup() {
  const { values } = parseArgs({
    options: {
      strict: { type: 'boolean', default: false },
      profile: { type: 'string', default: 'production' }
    }
  });

  const strict = values.strict;
  const profile = values.profile === 'preview' ? 'preview' : 'production';
  const errors = [];
  const warnings = [];
  const requiredEnvKeys = profile === 'preview'
    ? REQUIRED_ENV_KEYS_PREVIEW
    : REQUIRED_ENV_KEYS;

  for (const key of requiredEnvKeys) {
    if (!process.env[key]) {
      errors.push(`環境変数が未設定: ${key}`);
    }
  }

  for (const key of OPTIONAL_ENV_KEYS) {
    if (!process.env[key]) {
      warnings.push(`環境変数が未設定（任意）: ${key}`);
    }
  }

  if (profile === 'preview') {
    warnings.push('previewプロファイル: SMTP必須チェックはスキップしました');
  }

  for (const file of REQUIRED_FILES) {
    const exists = await checkFileExists(file);
    if (!exists) {
      errors.push(`入力ファイルが見つかりません: ${file}`);
    }
  }

  if (!process.env.TODO_REPORT_PHONE_LOG_CSV_URL) {
    warnings.push('電話CSVはURL同期されません（raw-phone-log.csv のローカル内容を使用）');
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Todoレポート実行前チェック: 問題なし');
    return;
  }

  if (warnings.length > 0) {
    console.warn('⚠️ 注意事項:');
    warnings.forEach(item => console.warn(`  - ${item}`));
  }

  if (errors.length > 0) {
    console.error('❌ 設定エラー:');
    errors.forEach(item => console.error(`  - ${item}`));
    process.exit(1);
  }

  if (strict && warnings.length > 0) {
    console.error('❌ strictモードのため警告をエラー扱いにしました');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateTodoReportSetup().catch(error => {
    console.error('❌ 実行前チェックに失敗しました:', error.message);
    process.exit(1);
  });
}

export default validateTodoReportSetup;
