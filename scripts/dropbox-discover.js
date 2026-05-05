#!/usr/bin/env node

/**
 * チーム名前空間・パスが合わないときの調査用。
 * - root_info の内容を表示
 * - Path-Root なし / root_namespace_id / home_namespace_id それぞれで list_folder ""
 * - search_v2 でキーワード一致の path_lower を表示
 *
 *   npm run dropbox-discover
 */

import 'dotenv/config';
import { getDropboxRootInfoForDebug } from './dropbox-team-path-root.js';

function normalizeDropboxPathChars(p) {
  return String(p ?? '').replace(/\u30FB/g, '\uFF65');
}

function pathRootFromNamespaceId(ns) {
  if (!ns) return null;
  return JSON.stringify({ '.tag': 'namespace_id', namespace_id: String(ns) });
}

async function listFolderRaw(token, folderPath, pathRootHeader) {
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
    return { ok: false, status: res.status, text };
  }
  return { ok: true, data: JSON.parse(text) };
}

function extractPathFromSearchMatch(match) {
  const inner = match.metadata?.metadata;
  if (!inner) return null;
  return inner.path_lower || inner.path_display || null;
}

function extractNameFromSearchMatch(match) {
  const inner = match.metadata?.metadata;
  if (!inner) return null;
  return inner.name || null;
}

async function searchV2(token, query, pathRootHeader) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (pathRootHeader) {
    headers['Dropbox-API-Path-Root'] = pathRootHeader;
  }
  const res = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      options: {
        path: '',
        max_results: 30,
        file_status: 'active'
      }
    })
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, text };
  }
  return { ok: true, data: JSON.parse(text) };
}

async function main() {
  const token = process.env.TODO_REPORT_DROPBOX_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error('❌ TODO_REPORT_DROPBOX_ACCESS_TOKEN が未設定です');
    process.exit(1);
  }

  console.log('=== users/get_current_account.root_info ===\n');
  const ri = await getDropboxRootInfoForDebug(token);
  console.log(JSON.stringify(ri, null, 2));
  console.log('');

  /** @type {{ label: string, header: string|null }[]} */
  const variants = [{ label: 'Path-Root なし', header: null }];
  if (ri && ri['.tag'] === 'user') {
    if (ri.root_namespace_id) {
      variants.push({
        label: `Path-Root = root_namespace_id (${ri.root_namespace_id})`,
        header: pathRootFromNamespaceId(ri.root_namespace_id)
      });
    }
    if (ri.home_namespace_id) {
      variants.push({
        label: `Path-Root = home_namespace_id (${ri.home_namespace_id})`,
        header: pathRootFromNamespaceId(ri.home_namespace_id)
      });
    }
  } else if (ri && ri['.tag'] === 'team' && ri.root_namespace_id) {
    variants.push({
      label: `Path-Root = team root_namespace_id (${ri.root_namespace_id})`,
      header: pathRootFromNamespaceId(ri.root_namespace_id)
    });
  }

  for (const v of variants) {
    console.log(`\n--- list_folder path="" | ${v.label} ---`);
    const r = await listFolderRaw(token, '', v.header);
    if (!r.ok) {
      console.log(`失敗: ${r.status} ${r.text}`);
      continue;
    }
    const entries = r.data.entries || [];
    console.log(`エントリ数: ${entries.length}`);
    for (const e of entries.slice(0, 50)) {
      console.log(`  [${e['.tag']}] ${e.name}`);
      console.log(`       path_lower: ${e.path_lower || ''}`);
    }
    if (entries.length > 50) {
      console.log(`  ... 他 ${entries.length - 50} 件`);
    }
  }

  const queries = ['071', '文化財研究室', '地域創造'];
  for (const v of variants) {
    for (const q of queries) {
      console.log(`\n--- search_v2 "${q}" | ${v.label} ---`);
      const r = await searchV2(token, q, v.header);
      if (!r.ok) {
        console.log(`失敗: ${r.status} ${r.text}`);
        continue;
      }
      const matches = r.data.matches || [];
      let n = 0;
      for (const m of matches) {
        const pl = extractPathFromSearchMatch(m);
        const nm = extractNameFromSearchMatch(m);
        if (pl) {
          console.log(`  ${nm || '?'} → ${pl}`);
          n += 1;
        }
        if (n >= 20) break;
      }
      if (n === 0) {
        console.log('  (0件)');
      }
    }
  }

  const meetingPath = normalizeDropboxPathChars(process.env.TODO_REPORT_DROPBOX_MEETING_PATH?.trim() || '');
  if (meetingPath) {
    console.log(`\n--- TODO_REPORT_DROPBOX_MEETING_PATH を list_folder ---`);
    console.log(`パス（・→･ 正規化後）: ${meetingPath}\n`);
    for (const v of variants) {
      const r = await listFolderRaw(token, meetingPath, v.header);
      if (!r.ok) {
        console.log(`${v.label}: NG ${r.status}`);
      } else {
        const n = (r.data.entries || []).length;
        console.log(`${v.label}: OK（直下 ${n} エントリ）`);
      }
    }
  }

  console.log(
    '\n※ ここに「071」や打合せフォルダの path_lower が出たら、その文字列（先頭 / から）を .env の TODO_REPORT_DROPBOX_MEETING_PATH にコピーしてください。'
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
