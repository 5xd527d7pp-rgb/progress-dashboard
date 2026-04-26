#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  BUSINESS_ASSIGNEES,
  BUSINESS_NAME_ALIASES,
  ROUTINE_SUBMISSION_DEADLINE_DAYS,
  ROUTINE_TASK_TEMPLATES,
  STATUS_LABELS,
  DEFAULT_CLIENT_DEADLINE_HOUR
} from '../config/todo-report-settings.js';
import { isPhoneOnlyTodoReport } from './todo-report-source-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatIsoLocal(date, hour = '00:00') {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${hour}:00+09:00`;
}

function addDays(baseDate, days) {
  const copied = new Date(baseDate);
  copied.setDate(copied.getDate() + days);
  return copied;
}

function normalizeNameForMatch(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function harmonizeBusinessIdentity(tasks) {
  return tasks.map(task => {
    const target = normalizeNameForMatch(`${task.businessName} ${task.content}`);
    const alias = BUSINESS_NAME_ALIASES.find(item =>
      target.includes(normalizeNameForMatch(item.keyword))
    );
    if (!alias) return task;
    return {
      ...task,
      businessId: alias.businessId,
      businessName: alias.businessName
    };
  });
}

function harmonizeEventIdentity(events) {
  return events.map(event => {
    const target = normalizeNameForMatch(`${event.businessName} ${event.eventName}`);
    const alias = BUSINESS_NAME_ALIASES.find(item =>
      target.includes(normalizeNameForMatch(item.keyword))
    );
    if (!alias) return event;
    return {
      ...event,
      businessId: alias.businessId,
      businessName: alias.businessName
    };
  });
}

function normalizeTask(rawTask, sourceType) {
  const businessId = String(rawTask.businessId || '').trim();
  if (!businessId) {
    return null;
  }

  const assignee = BUSINESS_ASSIGNEES[businessId] || '未設定';

  return {
    sourceType,
    sourceId: rawTask.sourceId || `${sourceType}-${businessId}-${rawTask.content || 'task'}`,
    businessId,
    businessName: rawTask.businessName || `業務${businessId}`,
    status: rawTask.status || STATUS_LABELS.inProgress,
    assignee,
    content: rawTask.content || '未設定タスク',
    instructionMethod: rawTask.instructionMethod || '未設定',
    submittedAt: rawTask.submittedAt || null,
    responseDueAt: rawTask.responseDueAt || null,
    returnAt: rawTask.returnAt || null,
    clientDueAt: rawTask.clientDueAt || null,
    eventName: rawTask.eventName || null,
    eventDate: rawTask.eventDate || null
  };
}

function buildRoutineTasks(events) {
  const routineTasks = [];

  for (const event of events) {
    const templates = ROUTINE_TASK_TEMPLATES[event.eventType];
    if (!templates || templates.length === 0) {
      continue;
    }

    const eventDate = toDate(event.eventDate);
    if (!eventDate) {
      continue;
    }

    const dueDate = addDays(eventDate, ROUTINE_SUBMISSION_DEADLINE_DAYS);
    const responseDueAt = formatIsoLocal(dueDate, DEFAULT_CLIENT_DEADLINE_HOUR);
    const returnAt = formatIsoLocal(addDays(dueDate, -1), DEFAULT_CLIENT_DEADLINE_HOUR);

    for (const template of templates) {
      routineTasks.push(normalizeTask({
        sourceId: `${event.eventId}-${template.content}`,
        businessId: event.businessId,
        businessName: event.businessName,
        status: STATUS_LABELS.inProgress,
        content: template.content,
        instructionMethod: template.instructionMethod,
        submittedAt: null,
        responseDueAt,
        returnAt,
        clientDueAt: responseDueAt,
        eventName: event.eventName,
        eventDate: event.eventDate
      }, 'routine'));
    }
  }

  return routineTasks.filter(Boolean);
}

function isSameDay(isoA, isoB) {
  const a = toDate(isoA);
  const b = toDate(isoB);
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dedupeTasks(tasks) {
  const unique = [];

  for (const task of tasks) {
    const duplicate = unique.find(existing =>
      existing.businessId === task.businessId &&
      existing.content === task.content &&
      isSameDay(existing.responseDueAt, task.responseDueAt)
    );

    if (!duplicate) {
      unique.push(task);
    }
  }

  return unique;
}

function assignSerialNumbers(tasks) {
  return tasks
    .sort((a, b) => {
      const aDate = toDate(a.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = toDate(b.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      if (a.businessId !== b.businessId) return a.businessId.localeCompare(b.businessId);
      return a.content.localeCompare(b.content);
    })
    .map((task, index) => {
      return {
        ...task,
        serialNo: `SN-${String(index + 1).padStart(6, '0')}`
      };
    });
}

function getDateRangeThisWeek() {
  const today = new Date();
  const day = today.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = addDays(today, mondayDiff);
  monday.setHours(0, 0, 0, 0);
  const sunday = addDays(monday, 6);
  sunday.setHours(23, 59, 59, 999);

  return { startAt: monday.toISOString(), endAt: sunday.toISOString() };
}

function buildBusinessSummaries(tasks, events) {
  const map = new Map();

  for (const task of tasks) {
    if (!map.has(task.businessId)) {
      map.set(task.businessId, {
        businessId: task.businessId,
        businessName: task.businessName,
        assignee: BUSINESS_ASSIGNEES[task.businessId] || '未設定',
        events: [],
        tasks: []
      });
    }
    map.get(task.businessId).tasks.push(task);
  }

  for (const event of events) {
    const businessId = String(event.businessId);
    if (!map.has(businessId)) {
      map.set(businessId, {
        businessId,
        businessName: event.businessName || `業務${businessId}`,
        assignee: BUSINESS_ASSIGNEES[businessId] || '未設定',
        events: [],
        tasks: []
      });
    }
    map.get(businessId).events.push(event);
  }

  return Array.from(map.values()).map(item => {
    const latestByType = {};
    for (const event of item.events) {
      const current = latestByType[event.eventType];
      if (!current || toDate(event.eventDate) > toDate(current.eventDate)) {
        latestByType[event.eventType] = event;
      }
    }

    return {
      ...item,
      latestEvents: latestByType,
      tasks: item.tasks.sort((a, b) => {
        const aDate = toDate(a.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        const bDate = toDate(b.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      })
    };
  });
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function validateTasks(tasks) {
  const warnings = [];

  for (const task of tasks) {
    const submittedAt = toDate(task.submittedAt);
    const responseDueAt = toDate(task.responseDueAt);
    const returnAt = toDate(task.returnAt);
    const clientDueAt = toDate(task.clientDueAt);

    if (!responseDueAt) {
      warnings.push({
        serialNo: task.serialNo,
        type: 'missing-response-due',
        message: `${task.serialNo}: 返答期日が未設定です`
      });
      continue;
    }

    if (!clientDueAt) {
      warnings.push({
        serialNo: task.serialNo,
        type: 'missing-client-due',
        message: `${task.serialNo}: 客先提出期限が未設定です`
      });
      continue;
    }

    if (responseDueAt > clientDueAt) {
      warnings.push({
        serialNo: task.serialNo,
        type: 'response-after-client-due',
        message: `${task.serialNo}: 返答期日が客先提出期限を超過しています`
      });
    }

    if (returnAt && returnAt > clientDueAt) {
      warnings.push({
        serialNo: task.serialNo,
        type: 'return-after-client-due',
        message: `${task.serialNo}: 戻し日程が客先提出期限を超過しています`
      });
    }

    if (submittedAt && submittedAt > clientDueAt) {
      warnings.push({
        serialNo: task.serialNo,
        type: 'submit-after-client-due',
        message: `${task.serialNo}: 最終確認提出が客先提出期限を超過しています`
      });
    }
  }

  return warnings;
}

async function buildTodoReportData() {
  console.log('🧩 Todoレポート用データを作成中...');

  const sourceDir = path.join(__dirname, '..', 'data', 'todo-sources');
  const outputPath = path.join(__dirname, '..', 'data', 'todo-report-data.json');

  const [mailData, meetingData, phoneData, eventData] = await Promise.all([
    readJson(path.join(sourceDir, 'mail-todos.json')),
    readJson(path.join(sourceDir, 'meeting-log-todos.json')),
    readJson(path.join(sourceDir, 'phone-log-todos.json')),
    readJson(path.join(sourceDir, 'business-events.json'))
  ]);

  const phoneOnly = isPhoneOnlyTodoReport();
  const eventItems = phoneOnly ? [] : harmonizeEventIdentity(eventData.items || []);

  const rawTasks = phoneOnly
    ? [...(phoneData.items || []).map(item => normalizeTask(item, 'phone'))].filter(Boolean)
    : [
      ...(mailData.items || []).map(item => normalizeTask(item, 'mail')),
      ...(meetingData.items || []).map(item => normalizeTask(item, 'meeting')),
      ...(phoneData.items || []).map(item => normalizeTask(item, 'phone'))
    ].filter(Boolean);

  const routineTasks = phoneOnly ? [] : buildRoutineTasks(eventItems);
  const harmonizedTasks = harmonizeBusinessIdentity([...rawTasks, ...routineTasks]);
  const mergedTasks = dedupeTasks(harmonizedTasks);
  const tasksWithSerial = assignSerialNumbers(mergedTasks);
  const validationWarnings = validateTasks(tasksWithSerial);
  const businesses = buildBusinessSummaries(tasksWithSerial, eventItems);

  const reportData = {
    generatedAt: new Date().toISOString(),
    reportPeriod: getDateRangeThisWeek(),
    summary: {
      activeBusinessCount: businesses.length,
      totalTaskCount: tasksWithSerial.length,
      warningCount: validationWarnings.length,
      dueToSubmitTodayCount: tasksWithSerial.filter(task => {
        const submitted = toDate(task.submittedAt);
        if (!submitted) return false;
        const today = new Date();
        return (
          submitted.getFullYear() === today.getFullYear() &&
          submitted.getMonth() === today.getMonth() &&
          submitted.getDate() === today.getDate()
        );
      }).length
    },
    checks: {
      warningCount: validationWarnings.length,
      warnings: validationWarnings
    },
    businesses,
    ledger: [...tasksWithSerial].sort((a, b) => {
      const aDate = toDate(a.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = toDate(b.responseDueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    })
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(reportData, null, 2), 'utf-8');

  console.log(`✅ data/todo-report-data.json を生成しました（${tasksWithSerial.length}件）`);
  if (validationWarnings.length > 0) {
    console.warn(`⚠️ 期限整合性の警告: ${validationWarnings.length}件`);
    if (process.env.TODO_REPORT_FAIL_ON_WARNINGS === '1') {
      throw new Error('TODO_REPORT_FAIL_ON_WARNINGS=1 のため警告をエラーとして終了します');
    }
  }
  return reportData;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildTodoReportData().catch(error => {
    console.error('❌ Todoデータ生成エラー:', error.message);
    process.exit(1);
  });
}

export default buildTodoReportData;
