#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isDryRun() {
  return process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が設定されていません`);
  }
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

async function sendTodoReportEmail() {
  const dryRun = isDryRun();

  const smtpHost = dryRun ? optionalEnv('TODO_REPORT_SMTP_HOST', 'dry-run.local') : requiredEnv('TODO_REPORT_SMTP_HOST');
  const smtpPort = Number(process.env.TODO_REPORT_SMTP_PORT || '587');
  const smtpUser = dryRun ? optionalEnv('TODO_REPORT_SMTP_USER', 'dry-run-user') : requiredEnv('TODO_REPORT_SMTP_USER');
  const smtpPass = dryRun ? optionalEnv('TODO_REPORT_SMTP_PASS', 'dry-run-pass') : requiredEnv('TODO_REPORT_SMTP_PASS');
  const from = dryRun ? optionalEnv('TODO_REPORT_MAIL_FROM', 'dry-run@example.com') : requiredEnv('TODO_REPORT_MAIL_FROM');
  const to = dryRun ? optionalEnv('TODO_REPORT_MAIL_TO', 'dry-run@example.com') : requiredEnv('TODO_REPORT_MAIL_TO');

  const reportDataPath = path.join(__dirname, '..', 'data', 'todo-report-data.json');
  const reportData = JSON.parse(await fs.readFile(reportDataPath, 'utf-8'));

  let reportUrl = process.env.TODO_REPORT_PUBLIC_URL || '';
  if (!reportUrl) {
    try {
      const deployedUrlPath = path.join(__dirname, '..', 'data', 'todo-report-url.txt');
      reportUrl = (await fs.readFile(deployedUrlPath, 'utf-8')).trim();
    } catch {
      reportUrl = '';
    }
  }

  const generatedAt = new Date(reportData.generatedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const subject = `【自動送信】業務Todo週次レポート ${generatedAt}`;
  const warnings = reportData.checks?.warnings || [];
  const warningLines = warnings.slice(0, 3).map(item => `  - ${item.message}`);
  const text = [
    '業務Todo週次レポートを自動生成しました。',
    '',
    `- 生成日時: ${generatedAt}`,
    `- 同時進行中の業務: ${reportData.summary.activeBusinessCount}件`,
    `- 全作業タスク数: ${reportData.summary.totalTaskCount}件`,
    `- 期限整合性の警告: ${reportData.summary.warningCount}件`,
    ...(warningLines.length > 0 ? ['', '警告（先頭3件）:', ...warningLines] : []),
    '',
    reportUrl ? `レポートURL: ${reportUrl}` : 'レポートURL: （未設定）',
    '',
    'このメールは自動配信です。'
  ].join('\n');

  if (dryRun) {
    console.log('🧪 DRY RUN - メール送信は実行しません');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text
  });

  console.log(`✅ Todoレポートメールを送信しました: ${to}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendTodoReportEmail().catch(error => {
    console.error('❌ メール送信エラー:', error.message);
    process.exit(1);
  });
}

export default sendTodoReportEmail;
