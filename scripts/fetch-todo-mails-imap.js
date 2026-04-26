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

function getRequiredImapConfig() {
  const host = process.env.TODO_REPORT_MAIL_IMAP_HOST || '';
  const port = Number.parseInt(process.env.TODO_REPORT_MAIL_IMAP_PORT || '993', 10);
  const secure = String(process.env.TODO_REPORT_MAIL_IMAP_SECURE ?? '1').toLowerCase().trim() !== '0';
  const user = process.env.TODO_REPORT_MAIL_IMAP_USER || '';
  const pass = process.env.TODO_REPORT_MAIL_IMAP_PASS || '';

  if (!host || !user || !pass) return null;
  return { host, port, secure, user, pass };
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
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
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

async function fetchTodoMailsImap() {
  const config = getRequiredImapConfig();
  if (!config) {
    console.log('ℹ️ IMAP設定が未指定のためメール巡回をスキップします');
    return { skipped: true, saved: 0 };
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
    auth: { user: config.user, pass: config.pass }
  });

  let mailboxInfo;
  try {
    await client.connect();
    mailboxInfo = await client.mailboxOpen(MAILBOX);
    const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
    const sinceDate = pickLookbackDate();

    const fetched = [];
    for await (const msg of client.fetch(range, {
      uid: true,
      envelope: true,
      internalDate: true,
      source: true
    }, { uid: true })) {
      if (!msg.uid || !msg.source) continue;
      if (msg.internalDate && msg.internalDate < sinceDate && lastUid === 0) continue;
      fetched.push(msg);
      if (fetched.length >= Math.max(1, FETCH_LIMIT)) break;
    }

    let saved = 0;
    let maxUid = lastUid;
    for (const msg of fetched) {
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

    console.log(`✅ IMAP巡回完了: ${saved}件保存（mailbox=${MAILBOX}, lastUid=${maxUid}）`);
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
