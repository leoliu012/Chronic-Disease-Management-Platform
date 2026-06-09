import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  type CareReminderOccurrence,
  type CareReminderSchedule,
} from '../api/care-reminders';
import { EntityName } from './EntityName';

type CareGroupKind = 'VITAL' | 'MEDICATION' | 'QUESTIONNAIRE' | 'GENERAL';

type CareSubgroup<T> = {
  key: string;
  label: string;
  subtitle?: string | null;
  items: T[];
};

type CareGroup<T> = {
  kind: CareGroupKind;
  label: string;
  hint: string;
  subgroups: CareSubgroup<T>[];
  total: number;
};

type OccurrenceActions = {
  busyId?: string | null;
  onSend?: (id: string) => void;
  onResend?: (id: string) => void;
};

const CARE_GROUP_ORDER: CareGroupKind[] = ['VITAL', 'MEDICATION', 'QUESTIONNAIRE', 'GENERAL'];

const CARE_GROUP_META: Record<CareGroupKind, { label: string; hint: string }> = {
  VITAL: { label: '指标监测', hint: '血压、血糖、血氧等指标打卡' },
  MEDICATION: { label: '用药计划', hint: '按药品名称归类的服药提醒' },
  QUESTIONNAIRE: { label: '随访问卷', hint: '按问卷类型归类' },
  GENERAL: { label: '其他提醒', hint: '通知及其他患者触达事项' },
};

export function GroupedCareReminderSchedules({
  schedules,
  onNavigateToSource,
}: {
  schedules: CareReminderSchedule[];
  onNavigateToSource?: (sourceType: string, sourceId: string | null) => void;
}) {
  const groups = groupSchedules(
    schedules.filter((s) => s.sourceType === 'MEDICATION' || s.sourceType === 'VITAL'),
  );

  if (!groups.length) {
    return <p className="pe-admin-muted">暂无长期提醒。请先在用药计划或指标监测板块创建启用计划。</p>;
  }

  return (
    <div className="pe-clinical-group-list">
      {groups.map((group) => (
        <CareCategory
          key={group.kind}
          group={group}
          defaultOpen
          renderSubgroup={(subgroup) => (
            <ScheduleSubgroup
              key={subgroup.key}
              subgroup={subgroup}
              onNavigateToSource={onNavigateToSource}
            />
          )}
        />
      ))}
    </div>
  );
}

export function GroupedCareReminderOccurrences({
  rows,
  showPatient,
  showActions,
  actions,
}: {
  rows: CareReminderOccurrence[];
  showPatient?: boolean;
  showActions?: boolean;
  actions?: OccurrenceActions;
}) {
  const groups = groupOccurrences(rows);

  if (!groups.length) {
    return <p className="pe-admin-muted">近期没有需要跟进的提醒。</p>;
  }

  return (
    <div className="pe-clinical-group-list">
      {groups.map((group) => (
        <CareCategory
          key={group.kind}
          group={group}
          defaultOpen
          renderSubgroup={(subgroup) => (
            <OccurrenceSubgroup
              key={subgroup.key}
              subgroup={subgroup}
              showPatient={showPatient}
              showActions={showActions}
              actions={actions}
            />
          )}
        />
      ))}
    </div>
  );
}

function CareCategory<T>({
  group,
  defaultOpen,
  renderSubgroup,
}: {
  group: CareGroup<T>;
  defaultOpen: boolean;
  renderSubgroup: (subgroup: CareSubgroup<T>) => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="pe-clinical-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="pe-clinical-group-summary">
        <span className="pe-clinical-caret" aria-hidden="true">›</span>
        <span className={`pe-clinical-type-mark pe-clinical-type-mark-${group.kind.toLowerCase()}`} aria-hidden="true" />
        <span className="pe-clinical-group-title-wrap">
          <strong>{group.label}</strong>
          <small>{group.hint}</small>
        </span>
        <span className="pe-clinical-count">{group.total} 条</span>
      </summary>
      <div className="pe-clinical-subgroup-list">
        {group.subgroups.map(renderSubgroup)}
      </div>
    </details>
  );
}

function ScheduleSubgroup({
  subgroup,
  onNavigateToSource,
}: {
  subgroup: CareSubgroup<CareReminderSchedule>;
  onNavigateToSource?: (sourceType: string, sourceId: string | null) => void;
}) {
  const [open, setOpen] = useState(subgroup.items.length <= 3);
  const kind = scheduleGroupKind(subgroup.items[0]);
  return (
    <details
      className="pe-clinical-subgroup"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="pe-clinical-subgroup-summary">
        <span className="pe-clinical-caret" aria-hidden="true">›</span>
        <span className="pe-clinical-subgroup-name">
          <EntityName kind={kind === 'VITAL' ? 'vital' : kind === 'MEDICATION' ? 'medication' : 'plan'}>
            {subgroup.label}
          </EntityName>
          {subgroup.subtitle ? <small>{subgroup.subtitle}</small> : null}
        </span>
        <span className="pe-clinical-count">{subgroup.items.length} 项</span>
      </summary>
      <div className="pe-admin-table-wrap">
        <table className="pe-admin-messages-table pe-clinical-table">
          <thead>
            <tr>
              <th>提醒事项</th>
              <th>频率</th>
              <th>提醒时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {subgroup.items.map((schedule) => (
              <tr key={schedule.id}>
                <td>
                  <strong className="pe-clinical-row-title">{schedule.title || subgroup.label}</strong>
                  {sourceSubtitle(schedule) ? <small>{sourceSubtitle(schedule)}</small> : null}
                </td>
                <td>{frequencyText(schedule)}</td>
                <td>{scheduledTimesText(schedule)}</td>
                <td>
                  <span className={`pe-admin-status pe-admin-status-${schedule.isActive ? 'active' : 'inactive'}`}>
                    {schedule.isActive ? '已启用' : '已停用'}
                  </span>
                </td>
                <td className="pe-admin-actions-cell">
                  <button
                    type="button"
                    className="pe-admin-secondary"
                    onClick={() => onNavigateToSource?.(schedule.sourceType, schedule.sourceId)}
                    title="前往对应计划板块查看或修改"
                  >
                    查看计划
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function OccurrenceSubgroup({
  subgroup,
  showPatient,
  showActions,
  actions,
}: {
  subgroup: CareSubgroup<CareReminderOccurrence>;
  showPatient?: boolean;
  showActions?: boolean;
  actions?: OccurrenceActions;
}) {
  const [open, setOpen] = useState(subgroup.items.length <= 5);
  const schedule = subgroup.items[0]?.schedule;
  const kind = schedule ? scheduleGroupKind(schedule) : 'GENERAL';

  return (
    <details
      className="pe-clinical-subgroup"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="pe-clinical-subgroup-summary">
        <span className="pe-clinical-caret" aria-hidden="true">›</span>
        <span className="pe-clinical-subgroup-name">
          <EntityName kind={kind === 'VITAL' ? 'vital' : kind === 'MEDICATION' ? 'medication' : 'plan'}>
            {subgroup.label}
          </EntityName>
          {subgroup.subtitle ? <small>{subgroup.subtitle}</small> : null}
        </span>
        <span className="pe-clinical-summary-statuses">
          {occurrenceSummaryBadges(subgroup.items)}
        </span>
        <span className="pe-clinical-count">{subgroup.items.length} 条</span>
      </summary>
      <div className="pe-admin-table-wrap">
        <table className="pe-admin-messages-table pe-clinical-table">
          <thead>
            <tr>
              <th>计划时间</th>
              {showPatient ? <th>患者</th> : null}
              <th>提醒事项</th>
              <th>状态</th>
              <th>后续处理</th>
              {showActions ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {subgroup.items.map((occurrence) => (
              <tr key={occurrence.id}>
                <td>{fmtDateTime(occurrence.dueAt)}</td>
                {showPatient ? (
                  <td>
                    {occurrence.patient ? (
                      <Link className="pe-admin-text-link" to={`/patients/${occurrence.patientId}`}>
                        {occurrence.patient.name}
                      </Link>
                    ) : (
                      '患者档案'
                    )}
                  </td>
                ) : null}
                <td>
                  <strong className="pe-clinical-row-title">{occurrence.title}</strong>
                </td>
                <td><OccurrenceStatusBadge status={occurrence.status} /></td>
                <td>{followUpText(occurrence)}</td>
                {showActions ? (
                  <td className="pe-admin-actions-cell">
                    {occurrence.status === 'PENDING' ? (
                      <button
                        type="button"
                        className="pe-admin-primary"
                        disabled={actions?.busyId === occurrence.id}
                        onClick={() => actions?.onSend?.(occurrence.id)}
                      >
                        立即发送
                      </button>
                    ) : null}
                    {(occurrence.status === 'SENT' || occurrence.status === 'CLICKED') && !occurrence.completedAt ? (
                      <button
                        type="button"
                        className="pe-admin-secondary"
                        disabled={actions?.busyId === occurrence.id}
                        onClick={() => actions?.onResend?.(occurrence.id)}
                      >
                        再次发送
                      </button>
                    ) : null}
                    {occurrence.status === 'MISSED' || occurrence.status === 'ESCALATED' ? (
                      <Link className="pe-admin-secondary pe-admin-link-as-button" to={`/patients/${occurrence.patientId}`}>
                        查看患者
                      </Link>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function groupSchedules(items: CareReminderSchedule[]): CareGroup<CareReminderSchedule>[] {
  return buildGroups(items, (item) => item, (item) => item.reminderType);
}

function groupOccurrences(items: CareReminderOccurrence[]): CareGroup<CareReminderOccurrence>[] {
  return buildGroups(items, (item) => item.schedule, (item) => item.occurrenceType);
}

function buildGroups<T>(
  items: T[],
  scheduleOf: (item: T) => CareReminderSchedule | undefined,
  reminderTypeOf: (item: T) => string,
): CareGroup<T>[] {
  const map = new Map<CareGroupKind, Map<string, CareSubgroup<T>>>();

  for (const item of items) {
    const schedule = scheduleOf(item);
    const kind = schedule ? scheduleGroupKind(schedule) : reminderTypeGroupKind(reminderTypeOf(item));
    const subgroup = schedule
      ? scheduleSubgroup(schedule)
      : { key: `fallback:${safeText(reminderTypeOf(item), '其他提醒')}`, label: safeText(reminderTypeOf(item), '其他提醒') };
    const kindMap = map.get(kind) ?? new Map<string, CareSubgroup<T>>();
    const current = kindMap.get(subgroup.key) ?? {
      key: subgroup.key,
      label: subgroup.label,
      subtitle: subgroup.subtitle,
      items: [],
    };
    current.items.push(item);
    kindMap.set(subgroup.key, current);
    map.set(kind, kindMap);
  }

  return CARE_GROUP_ORDER.flatMap((kind) => {
    const kindMap = map.get(kind);
    if (!kindMap) return [];
    const meta = CARE_GROUP_META[kind];
    const subgroups = [...kindMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    return [{
      kind,
      label: meta.label,
      hint: meta.hint,
      subgroups,
      total: subgroups.reduce((sum, subgroup) => sum + subgroup.items.length, 0),
    }];
  });
}

function scheduleGroupKind(schedule: CareReminderSchedule): CareGroupKind {
  if (schedule.sourceType === 'VITAL' || schedule.reminderType === 'VITAL_RECHECK') return 'VITAL';
  if (schedule.sourceType === 'MEDICATION' || schedule.reminderType === 'MEDICATION_CHECKIN') return 'MEDICATION';
  if (schedule.sourceType === 'QUESTIONNAIRE' || schedule.reminderType === 'QUESTIONNAIRE') return 'QUESTIONNAIRE';
  return 'GENERAL';
}

function reminderTypeGroupKind(reminderType: string): CareGroupKind {
  if (reminderType === 'VITAL_RECHECK') return 'VITAL';
  if (reminderType === 'MEDICATION_CHECKIN') return 'MEDICATION';
  if (reminderType === 'QUESTIONNAIRE') return 'QUESTIONNAIRE';
  return 'GENERAL';
}

function scheduleSubgroup(schedule: CareReminderSchedule): { key: string; label: string; subtitle?: string | null } {
  const payload = (schedule.payload || {}) as Record<string, unknown>;
  const kind = scheduleGroupKind(schedule);

  if (kind === 'VITAL') {
    const label = localizeVital(stringValue(schedule.sourceSummary?.title) || stringValue(payload.vitalType) || schedule.title);
    return { key: `vital:${label}`, label, subtitle: sourceSubtitle(schedule) };
  }

  if (kind === 'MEDICATION') {
    const label = safeText(stringValue(schedule.sourceSummary?.title) || stringValue(payload.medicationName) || schedule.title, '用药计划');
    return { key: `medication:${label}`, label, subtitle: sourceSubtitle(schedule) };
  }

  if (kind === 'QUESTIONNAIRE') {
    const label = localizeQuestionnaire(stringValue(payload.questionnaireType) || schedule.title);
    return { key: `questionnaire:${label}`, label };
  }

  const label = safeText(schedule.title, '其他提醒');
  return { key: `general:${label}`, label };
}

function sourceSubtitle(schedule: CareReminderSchedule): string | null {
  const payload = (schedule.payload || {}) as Record<string, unknown>;
  return (
    stringValue(schedule.sourceSummary?.subtitle) ||
    stringValue(payload.dosage) ||
    stringValue(payload.frequency) ||
    null
  );
}

function occurrenceSummaryBadges(items: CareReminderOccurrence[]) {
  const missed = items.filter((item) => item.status === 'MISSED').length;
  const escalated = items.filter((item) => item.status === 'ESCALATED').length;
  return (
    <>
      {missed ? <span className="pe-admin-status pe-admin-status-failed">未完成 {missed}</span> : null}
      {escalated ? <span className="pe-admin-status pe-admin-status-escalated">已升级 {escalated}</span> : null}
    </>
  );
}

function followUpText(occurrence: CareReminderOccurrence): ReactNode {
  if (occurrence.status === 'ESCALATED' || occurrence.escalatedTaskId) {
    return <span className="pe-admin-follow-up-hint">已转入护士工作台</span>;
  }
  if (occurrence.status === 'MISSED') {
    return <span className="pe-admin-follow-up-hint">等待护士跟进</span>;
  }
  if (occurrence.status === 'COMPLETED') return '患者已完成';
  if (occurrence.status === 'SENT' || occurrence.status === 'CLICKED') return '等待患者提交';
  return '—';
}

function OccurrenceStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    PENDING: 'pending',
    SENDING: 'pending',
    SENT: 'sent',
    CLICKED: 'clicked',
    COMPLETED: 'submitted',
    MISSED: 'failed',
    ESCALATED: 'escalated',
    CANCELED: 'canceled',
  };
  const label: Record<string, string> = {
    PENDING: '待发送',
    SENDING: '发送中',
    SENT: '已发送',
    CLICKED: '已打开',
    COMPLETED: '已完成',
    MISSED: '未完成',
    ESCALATED: '已升级',
    CANCELED: '已取消',
  };
  return (
    <span className={`pe-admin-status pe-admin-status-${cls[status] || 'pending'}`}>
      {label[status] || status}
    </span>
  );
}

function scheduledTimesText(schedule: CareReminderSchedule): string {
  const times =
    (schedule.sourceSummary?.scheduledTimes && schedule.sourceSummary.scheduledTimes.length
      ? schedule.sourceSummary.scheduledTimes
      : schedule.scheduledTimes) || [];
  return times.length ? times.join('、') : '—';
}

function frequencyText(schedule: CareReminderSchedule): string {
  const unit = schedule.sourceSummary?.frequencyUnit || schedule.frequencyUnit || 'DAY';
  const times = schedule.sourceSummary?.timesPerUnit ?? schedule.timesPerUnit ?? 1;
  const unitLabel = unit === 'WEEK' ? '每周' : unit === 'MONTH' ? '每月' : '每日';
  return `${unitLabel} ${times} 次`;
}

function localizeVital(value?: string): string {
  if (!value) return '指标';
  const map: Record<string, string> = {
    BLOOD_PRESSURE: '血压（收缩压/舒张压）',
    BLOOD_GLUCOSE: '血糖',
    WEIGHT: '体重',
    HEART_RATE: '心率',
    SPO2: '血氧',
    TEMPERATURE: '体温',
  };
  return map[value] || value;
}

function localizeQuestionnaire(value?: string): string {
  if (!value) return '随访问卷';
  const map: Record<string, string> = {
    HYPERTENSION_FOLLOWUP: '高血压随访问卷',
    DIABETES_FOLLOWUP: '糖尿病随访问卷',
    COPD_FOLLOWUP: '慢阻肺随访问卷',
    GENERIC: '通用随访问卷',
  };
  return map[value] || value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeText(value: unknown, fallback: string): string {
  return stringValue(value) || fallback;
}

function fmtDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
