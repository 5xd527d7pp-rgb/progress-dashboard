#!/usr/bin/env node

/**
 * Dropbox API でフォルダ内の打合せ簿（.docx / .pdf / .txt / .md）を取得し、
 * analyze-todo-sources の入力先（既定: data/todo-input/meeting-docs）へ保存する。
 * CI（GitHub Actions）でも Mac なしで動かせる。
 *
 * 環境変数:
 * - TODO_REPORT_DROPBOX_ACCESS_TOKEN … Dropbox で発行したアクセストークン
 * - TODO_REPORT_DROPBOX_MEETING_PATH … Dropbox 上のフォルダパス（例: /業務/打合せ完成）
 * - TODO_REPORT_MEETING_INPUT_DIR … 保存先（未設定時は data/todo-input/meeting-docs）
 *
 * トークンまたはパスが未設定のときは同期をスキップ（電話CSVと同様）。
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDropboxPathRootHeader } from './dropbox-team-path-root.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_EXT = new Set(['.docx', '.pdf', '.txt', '.md']);

/**
 * Finder/Web の「・」(U+30FB) と Dropbox API の path_lower「･」(U+FF65) が
 * 一致しないと path/not_found になることがある。
 */
function normalizeDropboxPathChars(p) {
  return String(p ?? '').replace(/\u30FB/g, '\uFF65');
}

/** UI と同じく先頭スラッシュ付き。ルートのみ "/" も可 */
function normalizeDropboxFolderPath(p) {
  const s = normalizeDropboxPathChars(String(p ?? '').trim());
  if (!s) return '';
  if (s === '/') return '/';
  return s.startsWith('/') ? s : `/${s}`;
}

/** list_folder 用: ルートは空文字 */
function toListFolderApiPath(normalized) {
  if (!normalized || normalized === '/') return '';
  return normalized;
}

function rpcHeaders(token, pathRootHeader) {
  const h = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (pathRootHeader) {
    h['Dropbox-API-Path-Root'] = pathRootHeader;
  }
  return h;
}

async function dropboxRpc(token, apiPath, body, pathRootHeader) {
  const res = await fetch(`https://api.dropboxapi.com/2${apiPath}`, {
    method: 'POST',
    headers: rpcHeaders(token, pathRootHeader),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dropbox API ${apiPath}: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Node.js fetch の Headers は ByteString (各文字 0..255) のみ。
 * Dropbox-API-Arg に日本語 path を入れるときは UTF-8 バイト列を
 * 1バイト=1文字の「バイナリ文字列」にし、送るバイト列は UTF-8 のまま（公式 JS SDK と同様）。
 */
function dropboxApiArgHeaderForFetch(argObj) {
  const json = JSON.stringify(argObj);
  const bytes = Buffer.from(json, 'utf8');
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

async function listAllFileEntries(token, listFolderPath, pathRootHeader) {
  let result = await dropboxRpc(
    token,
    '/files/list_folder',
    {
      path: listFolderPath,
      recursive: true,
      include_mounted_folders: false
    },
    pathRootHeader
  );
  const entries = [...(result.entries || [])];
  while (result.has_more) {
    result = await dropboxRpc(
      token,
      '/files/list_folder/continue',
      { cursor: result.cursor },
      pathRootHeader
    );
    entries.push(...(result.entries || []));
  }
  return entries.filter(e => e['.tag'] === 'file');
}

async function downloadFile(token, dropboxPathLower, destFsPath, pathRootHeader) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Dropbox-API-Arg': dropboxApiArgHeaderForFetch({ path: dropboxPathLower })
  };
  if (pathRootHeader) {
    headers['Dropbox-API-Path-Root'] = pathRootHeader;
  }
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`download ${dropboxPathLower}: ${res.status} ${errText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destFsPath), { recursive: true });
  await fs.writeFile(destFsPath, buf);
}

/** folderPrefixLower は path_lower 形式（先頭 /、末尾スラッシュなし） */
function relativePathBelowFolder(folderPrefixLower, filePathLower) {
  const prefix =
    folderPrefixLower === '' ? '' : folderPrefixLower.replace(/\/$/, '');
  const pl = filePathLower;
  if (!prefix) {
    return pl.replace(/^\//, '');
  }
  if (pl.startsWith(`${prefix}/`)) {
    return pl.slice(prefix.length + 1);
  }
  if (pl === prefix) {
    return path.basename(pl);
  }
  throw new Error(`パスがフォルダ外です: ${filePathLower}（期待ルート: ${prefix || '(ルート)'})`);
}

function safeFsSegments(relPosix) {
  const parts = relPosix.split('/').filter(Boolean);
  for (const p of parts) {
    if (p === '..' || p === '.') {
      throw new Error(`不正なパス: ${relPosix}`);
    }
  }
  return parts;
}

export async function syncMeetingDocsFromDropbox() {
  const token = process.env.TODO_REPORT_DROPBOX_ACCESS_TOKEN || '';
  const folderRaw = process.env.TODO_REPORT_DROPBOX_MEETING_PATH || '';

  if (!token.trim() || !folderRaw.trim()) {
    console.log(
      'ℹ️ Dropbox 打合せ簿同期をスキップ（TODO_REPORT_DROPBOX_ACCESS_TOKEN と TODO_REPORT_DROPBOX_MEETING_PATH を設定すると有効）'
    );
    return false;
  }

  const meetingRoot = normalizeDropboxFolderPath(folderRaw);
  const listPath = toListFolderApiPath(meetingRoot);
  /** 相対パス計算用（path_lower と比較） */
  const prefixLower = listPath === '' ? '' : listPath.toLowerCase();

  const outDir =
    process.env.TODO_REPORT_MEETING_INPUT_DIR ||
    path.join(__dirname, '..', 'data', 'todo-input', 'meeting-docs');

  console.log(`📦 Dropbox から打合せ簿を同期中… (${meetingRoot || '(ルート)'})`);

  const pathRootHeader = await getDropboxPathRootHeader(token);
  if (pathRootHeader) {
    console.log(
      '📎 チーム名前空間を使用します（Dropbox Business のチームフォルダ向け）。個人のみなら自動で付かない場合があります。'
    );
  }

  const entries = await listAllFileEntries(token, listPath, pathRootHeader);

  let saved = 0;
  for (const entry of entries) {
    const name = entry.name || '';
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      continue;
    }
    const pathLower = entry.path_lower || '';
    if (!pathLower) continue;

    const relPosix = relativePathBelowFolder(prefixLower, pathLower.toLowerCase());
    const segments = safeFsSegments(relPosix);
    const destPath = path.join(outDir, ...segments);

    await downloadFile(token, pathLower, destPath, pathRootHeader);
    saved += 1;
    console.log(`   ✅ ${pathLower} → ${destPath}`);
  }

  console.log(`✅ 打合せ簿 ${saved} ファイルを ${outDir} に保存しました`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncMeetingDocsFromDropbox().catch(error => {
    console.error('❌ Dropbox 打合せ簿同期エラー:', error.message);
    process.exit(1);
  });
}

export default syncMeetingDocsFromDropbox;
