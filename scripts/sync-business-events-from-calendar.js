#!/usr/bin/env node

/**
 * Apple カレンダー（macOS「カレンダー」）または .ics から business-events を同期します。
 *
 * - 手動登録分: eventId が ical- で始まらないものはそのまま残します。
 * - カレンダー由来: eventId は ical-<uid>。再実行で差し替え。
 *
 * 環境変数（優先順）:
 *   TODO_REPORT_BUSINESS_EVENTS_ICS_URL  … ICS を HTTP(S) で取得（GitHub Actions / Mac オフ向け）
 *   TODO_REPORT_BUSINESS_EVENTS_ICS_PATH … ローカル .ics ファイル
 *   （macOS のみ）Calendar.app（JXA）
 *   TODO_REPORT_CALENDAR_SYNC_CONFIG  既定: config/apple-calendar-sync.json
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import ICAL from 'ical.js';
import { BUSINESS_NAME_ALIASES } from '../config/todo-report-settings.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'apple-calendar-sync.json');
const OUTPUT = path.join(ROOT, 'data', 'todo-sources', 'business-events.json');

function optionalEnv(name, fallback = '') {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function slugUid(uid) {
  return String(uid)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

/**
 * 業務番号の省略形を 8 桁にそろえる。
 * - 8桁以上: 先頭8桁（フル指定）
 * - 4桁: yearPrefix + 4桁（例 0141 → 20260141）
 * - 5桁: yearPrefix + (数値 % 10000 を4桁)（例 60141 → 20260141）
 * - 1〜3桁: yearPrefix + 右側4桁相当にゼロ埋め（例 141 → 20260141）
 */
function normalizeBusinessId(raw, yearPrefix = '2026') {
  const s = String(raw || '').trim();
  if (!/^\d+$/.test(s)) {
    return s;
  }

  if (s.length >= 8) {
    return s.slice(0, 8);
  }

  const yp = String(yearPrefix || '2026').replace(/\D/g, '');
  const safeY = yp.length === 4 ? yp : '2026';

  if (s.length === 4) {
    return `${safeY}${s}`;
  }

  if (s.length === 5) {
    const tail = String(Number(s) % 10000).padStart(4, '0');
    return `${safeY}${tail}`;
  }

  if (s.length >= 1 && s.length <= 3) {
    const tail = String(Number(s)).padStart(4, '0');
    return `${safeY}${tail}`;
  }

  return s;
}

const CANONICAL_EVENT_TYPES = [
  'kickoff_meeting',
  'review_committee',
  'bunkacho_consultation'
];

/**
 * メモ欄: clientDue: / bid: / businessId: / type: / eventType:
 */
function parseDescriptionMeta(description) {
  const lines = String(description || '').split(/\r?\n/);
  let businessId = null;
  let typeKey = null;
  let clientDocumentDueAt = null;
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push(line);
      continue;
    }
    let m = t.match(/^clientDue:\s*(.+)$/i);
    if (m) {
      clientDocumentDueAt = m[1].trim();
      continue;
    }
    m = t.match(/^bid:\s*(\d{3,8})$/i);
    if (m) {
      businessId = m[1];
      continue;
    }
    m = t.match(/^businessId:\s*(\d{3,8})$/i);
    if (m) {
      businessId = m[1];
      continue;
    }
    m = t.match(/^type:\s*(.+)$/i);
    if (m) {
      typeKey = m[1].trim();
      continue;
    }
    m = t.match(/^eventType:\s*(.+)$/i);
    if (m) {
      typeKey = m[1].trim();
      continue;
    }
    kept.push(line);
  }
  return {
    businessId,
    typeKey,
    clientDocumentDueAt,
    notesRest: kept.join('\n').trim()
  };
}

function parseIcsFile(icsText) {
  const out = [];
  const jcal = ICAL.parse(icsText);
  const rootComp = new ICAL.Component(jcal);
  collectVevents(rootComp, out);
  return out;
}

function collectVevents(comp, bucket) {
  for (const vevent of comp.getAllSubcomponents('vevent')) {
    try {
      const ev = new ICAL.Event(vevent);
      const uid = ev.uid;
      if (!uid) continue;
      const start = ev.startDate;
      if (!start) continue;
      const startJs = start.toJSDate();
      bucket.push({
        calendar: 'ics',
        uid: String(uid),
        summary: ev.summary || '',
        startDate: startJs.toISOString(),
        description: ev.description || ''
      });
    } catch {
      /* skip malformed */
    }
  }
  for (const sub of comp.getAllSubcomponents('vcalendar')) {
    collectVevents(sub, bucket);
  }
}

async function fetchFromAppleCalendar(configPath) {
  const jxaPath = path.join(__dirname, 'jxa', 'fetch-calendar-events.js');
  await fs.access(jxaPath);
  const { stdout, stderr } = await execFileAsync(
    'osascript',
    ['-l', 'JavaScript', jxaPath, configPath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  if (stderr && stderr.trim()) {
    console.warn(stderr.trim());
  }
  const parsed = JSON.parse(stdout.trim());
  if (!parsed.ok) {
    throw new Error(parsed.error || 'JXA returned not ok');
  }
  return parsed.events || [];
}

async function fetchFromIcs(icsPath) {
  const text = await fs.readFile(icsPath, 'utf-8');
  return parseIcsFile(text);
}

/** webcal:// を https:// に（Apple の購読リンク対応） */
function normalizeWebcalUrl(url) {
  const s = String(url || '').trim();
  if (s.toLowerCase().startsWith('webcal://')) {
    return `https://${s.slice('webcal://'.length)}`;
  }
  return s;
}

function redactUrlForLog(url) {
  try {
    const u = new URL(url);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid-url>';
  }
}

async function fetchFromIcsUrl(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      'User-Agent': 'progress-dashboard-calendar-sync/1.0 (Node)'
    }
  });
  if (!res.ok) {
    throw new Error(`ICS URL HTTP ${res.status}`);
  }
  return parseIcsFile(await res.text());
}

function filterByRange(events, lookBackDays, lookAheadDays) {
  const now = Date.now();
  const start = new Date(now - lookBackDays * 86400000);
  const end = new Date(now + lookAheadDays * 86400000);
  return events.filter(e => {
    const d = new Date(e.startDate);
    if (Number.isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  });
}

function resolveEventType(rawKey, eventTypeMap) {
  const k = String(rawKey || '').trim();
  if (!k) return null;
  if (CANONICAL_EVENT_TYPES.includes(k)) {
    return k;
  }
  const lower = k.toLowerCase();
  if (eventTypeMap[k] != null) return eventTypeMap[k];
  if (eventTypeMap[lower] != null) return eventTypeMap[lower];
  if (eventTypeMap[k.normalize('NFKC')] != null) return eventTypeMap[k.normalize('NFKC')];
  return null;
}

const TOKYO_TZ = 'Asia/Tokyo';

/** NFKC・全角アンダースコア(U+FF3F)を ASCII _ にそろえてパースする */
function normalizeCalendarTitleForParse(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/\uFF3F/g, '_')
    .trim();
}

/** タイトル末尾の _HHMM（カレンダー件名全体から） */
function extractHmFromTitleSuffix(summaryNorm, config) {
  if (config.titleStripTimeSuffix === false) return null;
  const m = String(summaryNorm || '').match(/_(\d{4})$/);
  if (!m) return null;
  const hh = parseInt(m[1].slice(0, 2), 10);
  const mm = parseInt(m[1].slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) {
    return null;
  }
  return m[1];
}

/**
 * 種別キー末尾の _HHMM（24時間・4桁）を除去して eventTypeMap 照合に使う。
 * 取り除いた HHMM は返し、eventDate に反映できる。
 */
function stripTrailingHmFromTypeKey(raw, config) {
  if (config.titleStripTimeSuffix === false) {
    return { base: String(raw || '').trim(), hm: null };
  }
  const s = String(raw || '').trim();
  const m = s.match(/^(.+)_(\d{4})$/);
  if (!m) {
    return { base: s, hm: null };
  }
  const hh = parseInt(m[2].slice(0, 2), 10);
  const mm = parseInt(m[2].slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) {
    return { base: s, hm: null };
  }
  return { base: m[1].trim(), hm: m[2] };
}

/**
 * カレンダーイベントの「日付」（東京）を保ち、時刻だけタイトルの HHMM に置き換える。
 */
function applyTokyoWallTimeToIso(isoStr, hm) {
  if (!isoStr || !hm || hm.length !== 4) return isoStr;
  const hh = parseInt(hm.slice(0, 2), 10);
  const min = parseInt(hm.slice(2, 4), 10);
  if (Number.isNaN(hh) || Number.isNaN(min) || hh > 23 || min > 59) return isoStr;

  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value;
  const mo = parts.find(p => p.type === 'month')?.value;
  const da = parts.find(p => p.type === 'day')?.value;
  if (!y || !mo || !da) return isoStr;

  const wall = `${y}-${mo}-${da}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
  const out = new Date(wall);
  if (Number.isNaN(out.getTime())) return isoStr;
  return out.toISOString();
}

function buildKeywordAliasList(config) {
  const extra = Array.isArray(config.titleKeywordAliases)
    ? config.titleKeywordAliases
    : [];
  const useSettings = config.useSettingsKeywordAliases !== false;
  const fromSettings = useSettings ? [...BUSINESS_NAME_ALIASES] : [];
  const merged = [];
  const seen = new Set();
  for (const entry of [...extra, ...fromSettings]) {
    const k = String(entry.keyword || '').normalize('NFKC').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push({
      keyword: entry.keyword,
      businessId: String(entry.businessId || '').trim(),
      businessName: entry.businessName || null
    });
  }
  merged.sort((a, b) => String(b.keyword).length - String(a.keyword).length);
  return merged;
}

/**
 * 「四條畷市_文化庁協議」「舟木遺跡_初回打合せ」形式（区切り既定は _）
 */
function matchKeywordTitle(summaryNorm, mergedAliases, separator) {
  const norm = String(summaryNorm || '').trim();
  const sep = separator != null && separator !== '' ? separator : '_';
  if (!norm || mergedAliases.length === 0) {
    return null;
  }

  for (const entry of mergedAliases) {
    const kw = String(entry.keyword || '').normalize('NFKC').trim();
    if (!kw || !entry.businessId) continue;
    const pref = kw + sep;
    if (norm === kw) {
      return {
        businessId: entry.businessId,
        typeKey: '',
        eventName: summaryNorm,
        businessNameFromAlias: entry.businessName || null
      };
    }
    if (norm.startsWith(pref)) {
      const rest = norm.slice(pref.length).trim();
      return {
        businessId: entry.businessId,
        typeKey: rest,
        eventName: summaryNorm,
        businessNameFromAlias: entry.businessName || null
      };
    }
  }
  return null;
}

function mapRawToBusinessEvents(rawEvents, config) {
  const patternSource =
    config.titlePattern ||
    '^\\[(\\d{3,8})\\]\\s*\\[([^\\]]+)\\]\\s*(.*)$';
  const flags = config.titlePatternFlags || '';
  const titleRe = new RegExp(patternSource, flags);
  const eventTypeMap = config.eventTypeMap || {};
  const businessNames = config.businessNames || {};
  const calendarFallback = config.calendarFallback || {};
  const yearPrefix = config.businessIdYearPrefix ?? '2026';

  const items = [];
  const skipped = [];

  const keywordAliases = buildKeywordAliasList(config);
  const kwSep = config.titleKeywordSeparator;

  for (const ev of rawEvents) {
    const summaryRaw = String(ev.summary || '').trim();
    const summaryNorm = normalizeCalendarTitleForParse(summaryRaw);
    const meta = parseDescriptionMeta(ev.description);
    const calName = String(ev.calendar || '');
    let aliasBusinessName = null;

    const m = summaryNorm.match(titleRe);
    let businessId;
    let typeKey;
    let eventName;

    if (m) {
      businessId = String(m[1] || '').trim();
      typeKey = String(m[2] || '').trim();
      eventName = String(m[3] || '').trim() || summaryRaw || '(タイトルなし)';
    } else if (meta.businessId && meta.typeKey) {
      businessId = meta.businessId;
      typeKey = meta.typeKey;
      eventName = summaryRaw || '(タイトルなし)';
    } else {
      const kwMatch = matchKeywordTitle(summaryNorm, keywordAliases, kwSep);
      if (kwMatch) {
        if (!kwMatch.typeKey) {
          skipped.push({
            summary: summaryRaw || '(無題)',
            reason: 'keyword_needs_suffix',
            calendar: calName
          });
          continue;
        }
        businessId = kwMatch.businessId;
        typeKey = kwMatch.typeKey;
        eventName = summaryRaw || '(タイトルなし)';
        aliasBusinessName = kwMatch.businessNameFromAlias;
      } else {
        const fb = calendarFallback[calName];
        if (fb && fb.businessId && fb.eventType) {
          businessId = String(fb.businessId).trim();
          typeKey = String(fb.eventType).trim();
          eventName = summaryRaw || '(タイトルなし)';
        } else {
          skipped.push({
            summary: summaryRaw || '(無題)',
            reason: 'title_pattern',
            calendar: calName
          });
          continue;
        }
      }
    }

    const strippedType = stripTrailingHmFromTypeKey(typeKey, config);
    typeKey = strippedType.base;
    let titleHm = strippedType.hm;
    if (!titleHm) {
      titleHm = extractHmFromTitleSuffix(summaryNorm, config);
    }

    const eventType = resolveEventType(typeKey, eventTypeMap);
    if (!eventType) {
      skipped.push({
        summary: summaryRaw || '(無題)',
        reason: 'unknown_event_type',
        typeKey,
        calendar: calName
      });
      continue;
    }

    businessId = normalizeBusinessId(businessId, yearPrefix);

    const dueFromNote = meta.clientDocumentDueAt;
    const businessName =
      businessNames[businessId] ||
      aliasBusinessName ||
      `業務${businessId}`;

    const eventId = `ical-${slugUid(ev.uid)}`;

    let eventDateIso = ev.startDate;
    if (
      titleHm &&
      config.applyTitleHmToEventDate !== false
    ) {
      eventDateIso = applyTokyoWallTimeToIso(ev.startDate, titleHm);
    }

    const item = {
      eventId,
      businessId,
      businessName,
      eventType,
      eventName,
      eventDate: eventDateIso,
      source: 'apple-calendar'
    };
    if (dueFromNote) {
      item.clientDocumentDueAt = dueFromNote;
    }
    items.push(item);
  }

  return { items, skipped };
}

async function main() {
  const configPath = optionalEnv(
    'TODO_REPORT_CALENDAR_SYNC_CONFIG',
    DEFAULT_CONFIG
  );

  let config;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch (e) {
    console.log(
      `⏭️  calendar sync をスキップ（設定なし）: ${configPath} を作成すると有効になります`
    );
    process.exit(0);
  }

  const lookBackDays =
    config.lookBackDays != null ? Number(config.lookBackDays) : 30;
  const lookAheadDays =
    config.lookAheadDays != null ? Number(config.lookAheadDays) : 120;

  const icsUrlRaw = optionalEnv('TODO_REPORT_BUSINESS_EVENTS_ICS_URL');
  const icsPath = optionalEnv('TODO_REPORT_BUSINESS_EVENTS_ICS_PATH');
  let rawEvents;

  if (icsUrlRaw) {
    const icsUrl = normalizeWebcalUrl(icsUrlRaw);
    console.log(`📅 .ics を URL から取得: ${redactUrlForLog(icsUrl)}`);
    rawEvents = await fetchFromIcsUrl(icsUrl);
    rawEvents = filterByRange(rawEvents, lookBackDays, lookAheadDays);
  } else if (icsPath) {
    console.log(`📅 .ics を読み込み: ${icsPath}`);
    rawEvents = await fetchFromIcs(icsPath);
    rawEvents = filterByRange(rawEvents, lookBackDays, lookAheadDays);
  } else if (process.platform === 'darwin') {
    console.log(`📅 Calendar.app から取得（JXA）…`);
    rawEvents = await fetchFromAppleCalendar(configPath);
    rawEvents = filterByRange(rawEvents, lookBackDays, lookAheadDays);
  } else {
    console.log(
      '⏭️  calendar sync をスキップ（Linux 等では TODO_REPORT_BUSINESS_EVENTS_ICS_URL または TODO_REPORT_BUSINESS_EVENTS_ICS_PATH を設定してください）'
    );
    process.exit(0);
  }

  const mapped = mapRawToBusinessEvents(rawEvents, config);
  let calendarItems = mapped.items;
  const skipped = mapped.skipped;

  const byEventId = new Map();
  for (const it of calendarItems) {
    byEventId.set(it.eventId, it);
  }
  calendarItems = [...byEventId.values()];

  let existing;
  try {
    existing = JSON.parse(await fs.readFile(OUTPUT, 'utf-8'));
  } catch {
    existing = { items: [] };
  }

  const manualItems = (existing.items || []).filter(
    item => item && !String(item.eventId || '').startsWith('ical-')
  );

  const merged = {
    items: [...manualItems, ...calendarItems]
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(merged, null, 2), 'utf-8');

  console.log(
    `✅ ${OUTPUT} を更新（手動 ${manualItems.length}件 + カレンダー ${calendarItems.length}件）`
  );
  if (skipped.length > 0) {
    console.warn(
      `⚠️  パースできなかったイベント ${skipped.length}件（件名の [業務ID][種別]・「市町村名_種別」・メモの bid:/type:・calendarFallback を確認）`
    );
    const preview = skipped.slice(0, 5);
    for (const s of preview) {
      console.warn(`   - ${s.summary?.slice(0, 80)} (${s.reason}${s.typeKey ? `: ${s.typeKey}` : ''})`);
    }
  }
}

main().catch(err => {
  console.error('❌', err.message || err);
  process.exit(1);
});
