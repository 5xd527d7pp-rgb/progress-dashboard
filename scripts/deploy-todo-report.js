#!/usr/bin/env node

import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function deployTodoReport() {
  console.log('🚀 TodoレポートをSurgeへデプロイ中...');

  const htmlPath = path.join(__dirname, '..', 'output', 'todo-report.html');
  const deployDir = path.join(__dirname, '..', 'dist', 'todo-report');
  const indexPath = path.join(deployDir, 'index.html');
  const domain = process.env.TODO_REPORT_SURGE_DOMAIN || process.env.MAGAZINE_SURGE_DOMAIN;

  if (!domain) {
    throw new Error('TODO_REPORT_SURGE_DOMAIN または MAGAZINE_SURGE_DOMAIN を設定してください');
  }

  await fs.access(htmlPath);
  await fs.mkdir(deployDir, { recursive: true });
  await fs.copyFile(htmlPath, indexPath);

  await execAsync(`npx surge --project "${deployDir}" --domain "${domain}"`, {
    env: {
      ...process.env,
      CI: 'true',
      SURGE_LOGIN: process.env.TODO_REPORT_SURGE_LOGIN || process.env.MAGAZINE_SURGE_LOGIN || '',
      SURGE_TOKEN: process.env.TODO_REPORT_SURGE_TOKEN || process.env.MAGAZINE_SURGE_TOKEN || ''
    }
  });

  const url = `https://${domain}`;
  const urlPath = path.join(__dirname, '..', 'data', 'todo-report-url.txt');
  await fs.mkdir(path.dirname(urlPath), { recursive: true });
  await fs.writeFile(urlPath, url, 'utf-8');
  console.log(`✅ デプロイ完了: ${url}`);
  return url;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployTodoReport().catch(error => {
    console.error('❌ Todoレポートデプロイエラー:', error.message);
    process.exit(1);
  });
}

export default deployTodoReport;
