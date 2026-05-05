#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIL_INPUT_DIR = process.env.TODO_REPORT_MAIL_INPUT_DIR
  || path.join(__dirname, '..', 'data', 'todo-input', 'mails');
const STATE_PATH = process.env.TODO_REPORT_MAIL_IMAP_STATE_PATH
  || path.join(__dirname, '..', 'data', 'todo-input', '.imap-state.json');
const MAILBOX = process.env.TODO_REPORT_MAIL_IMAP_MAILBOX || 'INBOX';
const FETCH_LIMIT = Number.parseInt(process.env.TODO_REPORT_MAIL_IMAP_FETCH_LIMIT || '100', 10);
const LOOKBACK_DAYS = Number.parseInt(process.env.TODO_REPORT_MAIL_IMAP_LOOKBACK_DAYS || '14', 10);
const SOCKET_TIMEOUT_MS = Number.parseInt(process.env.TODO_REPORT_MAIL_IMAP_SOCKET_TIMEOUT_MS || '600000', 10);
const ALLOWLIST_PATH = process.env.TODO_REPORT_MAIL_ALLOWLIST_PATH
  || path.join(__dirname, '..', 'config', 'todo-mail-allowlist.json');

function getRequiredImapConfig() {
  const host = (process.env.TODO_REPORT_MAIL_IMAP_HOST || '').trim();
  const port = Number.parseInt(process.env.TODO_REPORT_MAIL_IMAP_PORT || '993', 10);
  const secure = String(process.env.TODO_REPORT_MAIL_IMAP_SECURE ?? '1').toLowerCase().trim() !== '0';
  const user = (process.env.TODO_REPORT_MAIL_IMAP_USER || '').trim();
  const pass = (process.env.TODO_REPORT_MAIL_IMAP_PASS || '').trim();

  if (!host || !user || !pass) return null;
  return { host, port, secure, user, pass };
}

/**
 * iCloud (imap.mail.me.com) は AUTHENTICATE PLAIN で拒否され、IMAP LOGIN では通ることがある。
 * @see https://github.com/LogicLabs-OU/OpenArchiver/issues/319
 * imapflow: auth.loginMethod === 'LOGIN' のとき RUN LOGIN を使い SASL PLAIN を避ける。
 */
function getImapAuthForClient(config) {
  const override = (process.env.TODO_REPORT_MAIL_IMAP_LOGIN_METHOD || '').trim().toUpperCase();
  let loginMethod;
  if (override === 'LOGIN') {
    loginMethod = 'LOGIN';
  } else if (override === 'PLAIN' || override === 'AUTH=PLAIN') {
    loginMethod = 'AUTH=PLAIN';
  } else if (override === 'AUTH=LOGIN') {
    loginMethod = 'AUTH=LOGIN';
  } else if (config.host === 'imap.mail.me.com' || config.host.endsWith('.mail.me.com')) {
    loginMethod = 'LOGIN';
  }

  const auth = { user: config.user, pass: config.pass };
  if (loginMethod) auth.loginMethod = loginMethod;
  return auth;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'mail';
}

function hashKey(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function normalizeEmail(addr) {
  return String(addr || '').trim().toLowerCase();
}

/** imapflow の envelope アドレスからメールアドレス文字列を取得 */
function collectEnvelopeAddresses(addrField) {
  if (!addrField) return [];
  const arr = Array.isArray(addrField) ? addrField : [addrField];
  const out = [];
  for (const a of arr) {
    if (!a) continue;
    const single = normalizeEmail(a.address || a.mailbox || '');
    if (single) out.push(single);
    if (a.local && a.host) {
      const built = normalizeEmail(`${a.local}@${a.host}`);
      if (built) out.push(built);
    }
  }
  return out;
}

async function loadAllowlistSet() {
  const rawEnv = process.env.TODO_REPORT_MAIL_ALLOWLIST;
  const fromEnv = rawEnv
    ? rawEnv.split(/[,;\s]+/).map(normalizeEmail).filter(Boolean)
    : [];

  let fromFile = [];
  try {
    const raw = await fs.readFile(ALLOWLIST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const list = parsed.addresses || parsed.emails || [];
    if (Array.isArray(list)) {
      fromFile = list.map(normalizeEmail).filter(Boolean);
    }
  } catch {
    // ファイルなしは許容（env のみ運用可）
  }

  const combined = [...new Set([...fromEnv, ...fromFile])];
  return new Set(combined);
}

/**
 * 許可リストが空ならフィルタしない（後方互換）。
 * 1件以上あれば From / Reply-To のいずれかが一致したメールだけ保存。
 */
function isAllowedSender(envelope, allowSet) {
  if (!allowSet || allowSet.size === 0) return true;

  const fromAddrs = collectEnvelopeAddresses(envelope?.from);
  const replyToAddrs = collectEnvelopeAddresses(envelope?.replyTo);
  const senderAddrs = collectEnvelopeAddresses(envelope?.sender);
  const candidates = [...fromAddrs, ...replyToAddrs, ...senderAddrs];

  for (const c of candidates) {
    if (allowSet.has(c)) return true;
  }
  return false;
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(
    STATE_PATH,
    JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    'utf-8'
  );
}

function stateKey(config) {
  return `${config.user}@${config.host}:${config.port}/${MAILBOX}`;
}

function buildFilename({ date, uid, subject }) {
  const datePart = date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    : 'nodate';
  const subjectPart = slugify(subject);
  return `${datePart}_uid${uid}_${subjectPart}.eml`;
}

function pickLookbackDate() {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(1, LOOKBACK_DAYS));
  return d;
}

/** `TODO_REPORT_MAIL_IMAP_SINCE=2026-04-01` のような ISO 日付（時刻省略可） */
function parseSinceEnv() {
  const raw = (process.env.TODO_REPORT_MAIL_IMAP_SINCE || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 初回、または `TODO_REPORT_MAIL_IMAP_USE_SEARCH=1` のとき UID SEARCH で範囲取得（4月以降の再取得など） */
function useSearchStrategy(lastUid) {
  if (lastUid === 0) return true;
  const flag = String(process.env.TODO_REPORT_MAIL_IMAP_USE_SEARCH || '').toLowerCase().trim();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/** @param {number[]} uids ascending */
function capUidList(uids, limit) {
  if (!uids.length || uids.length <= limit) return uids;
  return uids.slice(-limit);
}

async function fetchTodoMailsImap() {
  const config = getRequiredImapConfig();
  if (!config) {
    console.log('ℹ️ IMAP設定が未指定のためメール巡回をスキップします');
    return { skipped: true, saved: 0 };
  }

  const allowSet = await loadAllowlistSet();
  if (allowSet.size > 0) {
    console.log(`📋 メール許可リスト: ${allowSet.size}件（一致する送信元のみ保存）`);
  } else {
    console.log('📋 メール許可リスト: 未設定のため全件を対象にします（config/todo-mail-allowlist.json または TODO_REPORT_MAIL_ALLOWLIST を設定できます）');
  }

  await fs.mkdir(MAIL_INPUT_DIR, { recursive: true });

  const state = await readState();
  const key = stateKey(config);
  const prev = state[key] || {};
  const lastUid = Number(prev.lastUid || 0);
  const seenKeys = new Set(Array.isArray(prev.seen) ? prev.seen.slice(-5000) : []);

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: getImapAuthForClient(config),
    logger: false,
    socketTimeout: Math.max(60000, SOCKET_TIMEOUT_MS)
  });

  let mailboxInfo;
  try {
    await client.connect();
    mailboxInfo = await client.mailboxOpen(MAILBOX);
    const explicitSince = parseSinceEnv();
    const sinceDate = explicitSince ?? pickLookbackDate();
    const maxFetch = Math.max(1, FETCH_LIMIT);
    const searchStrategy = useSearchStrategy(lastUid);
    if (explicitSince) {
      console.log(`📅 取得開始日: ${sinceDate.toISOString().slice(0, 10)}（TODO_REPORT_MAIL_IMAP_SINCE）`);
    }
    if (searchStrategy && lastUid > 0) {
      console.log('ℹ️ UID SEARCH モード（TODO_REPORT_MAIL_IMAP_USE_SEARCH=1）: 指定日以降を再走査します');
    }

    let messageIterable;

    if (!searchStrategy) {
      const range = `${lastUid + 1}:*`;
      messageIterable = client.fetch(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      }, { uid: true });
    } else {
      const rawUids = await client.search({ since: sinceDate }, { uid: true });
      const uids = Array.isArray(rawUids) ? rawUids : [];
      const capped = capUidList(uids.sort((a, b) => a - b), maxFetch);
      if (capped.length === 0) {
        const fallbackLast =
          mailboxInfo?.uidNext != null && mailboxInfo.uidNext > 1
            ? Number(mailboxInfo.uidNext) - 1
            : lastUid;
        state[key] = {
          mailboxUidValidity: mailboxInfo.uidValidity || prev.mailboxUidValidity || null,
          lastUid: fallbackLast,
          updatedAt: new Date().toISOString(),
          seen: Array.from(seenKeys).slice(-5000)
        };
        await writeState(state);
        const rangeNote = explicitSince
          ? `（${sinceDate.toISOString().slice(0, 10)} 以降に該当なし）`
          : `（直近${LOOKBACK_DAYS}日に該当なし）`;
        console.log(
          `✅ IMAP巡回完了: 0件保存${rangeNote} 次回は UID ${fallbackLast} 以降のみ取得（通常モード時）`
        );
        return { skipped: false, saved: 0 };
      }
      async function* fetchUidsOneByOne() {
        for (const uid of capped) {
          try {
            for await (const msg of client.fetch(String(uid), {
              uid: true,
              envelope: true,
              internalDate: true,
              source: true
            }, { uid: true })) {
              yield msg;
            }
          } catch (e) {
            console.warn(`⚠️ UID ${uid} の取得をスキップ: ${e.message || e}`);
          }
        }
      }
      messageIterable = fetchUidsOneByOne();
    }

    const fetched = [];
    for await (const msg of messageIterable) {
      if (!msg.uid || !msg.source) continue;
      if (searchStrategy && msg.internalDate && msg.internalDate < sinceDate) continue;
      fetched.push(msg);
      if (fetched.length >= maxFetch) break;
    }

    let saved = 0;
    let skippedFilter = 0;
    let maxUid = lastUid;
    for (const msg of fetched) {
      if (!isAllowedSender(msg.envelope, allowSet)) {
        skippedFilter += 1;
        if (msg.uid > maxUid) maxUid = msg.uid;
        continue;
      }

      const subject = msg.envelope?.subject || 'no-subject';
      const mailDate = msg.internalDate || new Date();
      const messageId = msg.envelope?.messageId || '';
      const dedupeKey = hashKey(`${msg.uid}|${messageId}|${subject}|${mailDate.toISOString()}`);
      if (seenKeys.has(dedupeKey)) {
        if (msg.uid > maxUid) maxUid = msg.uid;
        continue;
      }

      const filename = buildFilename({ date: mailDate, uid: msg.uid, subject });
      const outputPath = path.join(MAIL_INPUT_DIR, filename);
      await fs.writeFile(outputPath, msg.source);
      seenKeys.add(dedupeKey);
      saved += 1;
      if (msg.uid > maxUid) maxUid = msg.uid;
    }

    state[key] = {
      mailboxUidValidity: mailboxInfo.uidValidity || prev.mailboxUidValidity || null,
      lastUid: maxUid,
      updatedAt: new Date().toISOString(),
      seen: Array.from(seenKeys).slice(-5000)
    };
    await writeState(state);

    const filterNote = allowSet.size > 0 ? `、許可外スキップ ${skippedFilter}件` : '';
    console.log(`✅ IMAP巡回完了: ${saved}件保存${filterNote}（mailbox=${MAILBOX}, lastUid=${maxUid}）`);
    return { skipped: false, saved };
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchTodoMailsImap().catch(error => {
    console.error('❌ IMAPメール巡回エラー:', error.message);
    process.exit(1);
  });
}

export default fetchTodoMailsImap;
