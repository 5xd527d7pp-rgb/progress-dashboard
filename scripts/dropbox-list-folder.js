#!/usr/bin/env node

/**
 * Dropbox の list_folder（非再帰）で「このパスが API から見えるか」を確認するデバッグ用。
 * 使い方（プロジェクトルートで）:
 *   node scripts/dropbox-list-folder.js ""
 *   node scripts/dropbox-list-folder.js "/071 都市・地域創造部 文化財研究室"
 *
 * 第1引数省略時は TODO_REPORT_DROPBOX_MEETING_PATH を使う（長いパスが not_found のときは親を渡す）。
 */

import 'dotenv/config';
import { getDropboxPathRootHeader } from './dropbox-team-path-root.js';

/** 「・」(U+30FB) → API の path_lower に合わせて「･」(U+FF65) */
function normalizeDropboxPathChars(p) {
  return String(p ?? '').replace(/\u30FB/g, '\uFF65');
}

async function listFolder(token, folderPath, pathRootHeader) {
  const pathArg = folderPath === '/' ? '' : folderPath;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (pathRootHeader) {
    headers['Dropbox-API-Path-Root'] = pathRootHeader;
  }
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      path: pathArg,
      recursive: false,
      include_mounted_folders: true
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  const token = process.env.TODO_REPORT_DROPBOX_ACCESS_TOKEN || '';
  if (!token.trim()) {
    console.error('❌ TODO_REPORT_DROPBOX_ACCESS_TOKEN が未設定です');
    process.exit(1);
  }

  const fromArgv = process.argv[2];
  const pathQuery = normalizeDropboxPathChars(
    fromArgv !== undefined ? fromArgv : process.env.TODO_REPORT_DROPBOX_MEETING_PATH || ''
  );

  console.log(`📂 list_folder (非再帰) path=${JSON.stringify(pathQuery === '' ? '(ルート)' : pathQuery)}`);

  try {
    const pathRootHeader = await getDropboxPathRootHeader(token);
    if (pathRootHeader) {
      console.log('📎 Dropbox-API-Path-Root を付与（チーム名前空間）');
    }
    const data = await listFolder(token, pathQuery, pathRootHeader);
    const entries = data.entries || [];
    console.log(`✅ ${entries.length} エントリ`);
    for (const e of entries) {
      const tag = e['.tag'];
      const pl = e.path_lower || '';
      const name = e.name || '';
      console.log(`   [${tag}] ${name}`);
      console.log(`          path_lower: ${pl}`);
    }
    if (entries.length === 0) {
      console.log('（空フォルダか、サブフォルダだけがさらに下にある場合は path を一段ずつ深くしてください）');
    }
  } catch (e) {
    console.error('❌', e.message);
    console.error('');
    console.error('よくある原因:');
    console.error('  - パスの綴り・全角半角・スペースが Web 表示と1文字でも違う');
    console.error('  - Dropbox Business のチームスペース → スクリプトが Path-Root を付けます。ダメなら .env に TODO_REPORT_DROPBOX_USE_HOME_NAMESPACE=1');
    console.error('  - アプリが App folder のみのときは /Apps/ 以外は見えない（Full Dropbox で作り直し）');
    process.exit(1);
  }
}

main();
