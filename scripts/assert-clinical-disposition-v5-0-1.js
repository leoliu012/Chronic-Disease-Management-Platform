#!/usr/bin/env node
/*
 * Static assertions for the clinical disposition v5.0.1 strict TypeScript hotfix.
 * Run from repository root:
 *   node scripts/assert-clinical-disposition-v5-0-1.js
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}
function must(text, snippet, message) {
  if (!text.includes(snippet)) throw new Error(`[fail] ${message}`);
}
function mustNot(text, snippet, message) {
  if (text.includes(snippet)) throw new Error(`[fail] ${message}`);
}

const disposition = read('apps/api/src/clinical-disposition/clinical-disposition.service.ts');
const workItems = read('apps/api/src/work-items/work-items.service.ts');

must(disposition, 'let task: Task | null = null;', 'signalRisk task variable is not explicitly nullable Task');
must(disposition, "Extract<AlertStatus, 'RESOLVED' | 'DISMISSED'>", 'closeByAlert enum union is not expressed as a type');
must(disposition, "Extract<TaskStatus, 'DONE' | 'CANCELED'>", 'closeByTask enum union is not expressed as a type');
mustNot(disposition, 'finalAlertStatus: AlertStatus.RESOLVED | AlertStatus.DISMISSED', 'value-style AlertStatus namespace type remains');
mustNot(disposition, 'finalTaskStatus: TaskStatus.DONE | TaskStatus.CANCELED', 'value-style TaskStatus namespace type remains');

must(workItems, 'type MissedOccurrence = Prisma.CareReminderOccurrenceGetPayload<{', 'missed occurrence payload alias missing');
must(workItems, 'const missedOccurrencesPromise: Promise<MissedOccurrence[]>', 'missed occurrence conditional promise is not explicitly typed');
must(workItems, 'const gatewayConflictsPromise: Promise<GatewayConflict[]>', 'gateway conflict conditional promise is not explicitly typed');
must(workItems, '.map((occurrence): WorkItem => {', 'care reminder escalation mapping lacks WorkItem contextual return type');
must(workItems, 'gatewayConflicts.map((record): WorkItem => ({', 'gateway conflict mapping lacks WorkItem contextual return type');

console.log('[done] clinical disposition v5.0.1 static assertions passed.');
