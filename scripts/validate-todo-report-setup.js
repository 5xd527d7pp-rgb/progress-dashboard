#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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

function getProfileFromArgv() {
  const argv = process.argv.slice(2);
  const profileArg = argv.find(arg => arg.startsWith('--profile='));
  if (!profileArg) {
    return 'production';
  }
  const value = profileArg.split('=')[1] || '';
  return value === 'preview' ? 'preview' : 'production';
}

function isStrictMode() {
  return process.argv.includes('--strict');
}

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
  const strict = isStrictMode();
  const profile = getProfileFromArgv();
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

  const hasDropboxStaticToken = Boolean(process.env.TODO_REPORT_DROPBOX_ACCESS_TOKEN);
  const hasDropboxRefreshSet =
    Boolean(process.env.TODO_REPORT_DROPBOX_APP_KEY) &&
    Boolean(process.env.TODO_REPORT_DROPBOX_APP_SECRET) &&
    Boolean(process.env.TODO_REPORT_DROPBOX_REFRESH_TOKEN);
  const hasDropboxAuth = hasDropboxStaticToken || hasDropboxRefreshSet;

  if (!hasDropboxAuth || !process.env.TODO_REPORT_DROPBOX_MEETING_PATH) {
    warnings.push(
      'Dropbox 打合せ簿は同期されません（TODO_REPORT_DROPBOX_MEETING_PATH と、TODO_REPORT_DROPBOX_ACCESS_TOKEN または TODO_REPORT_DROPBOX_APP_KEY/APP_SECRET/REFRESH_TOKEN を設定）'
    );
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
