import type { ActionShellResult } from './TaskActionShell';

/**
 * TaskActionHistory
 *
 * 展示本次工作台会话内、当前任务下所有已成功提交的处理动作。
 * 与全局 timeline 区别：只显示"在这一次任务处理页打开后"的提交记录，
 * 让护士能立刻看到自己已经做了什么，避免重复填写或漏掉某个动作。
 */

export type TaskActionHistoryEntry = ActionShellResult & {
  /** 哪个处理方式（PHONE / RECHECK / VISIT ...）。 */
  mode: string;
  /** 模块标题，用于展示。 */
  moduleTitle: string;
};

type Props = {
  entries: TaskActionHistoryEntry[];
  /**
   * 当用户点击某条记录的"查看"时回调，父组件可把对应模块切到 review。
   */
  onReview?: (mode: string) => void;
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function TaskActionHistory({ entries, onReview }: Props) {
  if (entries.length === 0) return null;

  return (
    <section className="panel task-action-history-panel" aria-label="本次处理记录">
      <header className="action-history-header">
        <div>
          <span>本次处理记录</span>
          <h2>当前任务已完成 {entries.length} 项处理</h2>
        </div>
        <p className="section-hint">
          只展示本次进入工作台后的提交记录。完整历史请到患者档案的时间线查看。
        </p>
      </header>
      <ol className="action-history-timeline">
        {entries.map((entry, idx) => (
          <li key={`${entry.mode}-${entry.savedAt}-${idx}`}>
            <span className="action-history-time">{formatTime(entry.savedAt)}</span>
            <span className="action-history-dot" aria-hidden />
            <div className="action-history-content">
              <strong>
                {entry.moduleTitle}
                <em className="action-history-tag">{entry.label}</em>
              </strong>
              {entry.details.length > 0 && (
                <p>{entry.details.join(' · ')}</p>
              )}
              {entry.syncedAlert && (
                <small className="action-history-synced">已同步处置关联风险预警</small>
              )}
            </div>
            {onReview && (
              <button
                type="button"
                className="ghost-button compact-link-btn"
                onClick={() => onReview(entry.mode)}
              >
                查看
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
