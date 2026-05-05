/**
 * Dropbox Business のチームスペースでは、list_folder / download に
 * Dropbox-API-Path-Root が無いと個人ホームだけが見え、チーム側パスが path/not_found になる。
 *
 * TODO_REPORT_DROPBOX_ROOT_NAMESPACE_ID があればそれを優先。
 * 無ければ users/get_current_account の root_info.root_namespace_id を使う。
 */

import 'dotenv/config';

/**
 * @returns {Promise<string|null>} Dropbox-API-Path-Root ヘッダー用 JSON 文字列、不要なら null
 */
export async function getDropboxPathRootHeader(token) {
  const manual = process.env.TODO_REPORT_DROPBOX_ROOT_NAMESPACE_ID?.trim();
  if (manual) {
    return JSON.stringify({
      '.tag': 'namespace_id',
      namespace_id: manual
    });
  }

  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: 'null'
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`⚠️ users/get_current_account: ${res.status} ${text}`);
    return null;
  }

  const account = JSON.parse(text);
  const ri = account.root_info;
  if (!ri) {
    return null;
  }

  const useHome = process.env.TODO_REPORT_DROPBOX_USE_HOME_NAMESPACE === '1';
  let ns = null;
  if (ri['.tag'] === 'user') {
    ns = useHome ? ri.home_namespace_id : ri.root_namespace_id;
  } else if (ri['.tag'] === 'team') {
    ns = ri.root_namespace_id;
  }
  if (!ns) {
    return null;
  }

  return JSON.stringify({
    '.tag': 'namespace_id',
    namespace_id: String(ns)
  });
}

/** デバッグ用：トークンに紐づく root_info（個人情報は出さない） */
export async function getDropboxRootInfoForDebug(token) {
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: 'null'
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`get_current_account: ${res.status} ${text}`);
  }
  const account = JSON.parse(text);
  return account.root_info || null;
}
