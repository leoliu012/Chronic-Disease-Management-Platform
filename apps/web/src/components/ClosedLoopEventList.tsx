import { useState } from 'react';

type TimelineEvent = {
  type: string;
  time: string;
  title: string;
  description: string;
  data: any;
};

type ClosedLoopEvent = {
  id: string;
  title: string;
  date: string;
  status: 'resolved' | 'open' | 'in-progress';
  trigger?: TimelineEvent;
  systemJudgment?: string;
  task?: TimelineEvent;
  action?: TimelineEvent;
  result?: string;
};

type Props = {
  events: ClosedLoopEvent[];
  formatTime: (value?: string) => string;
  localizeBackendText: (value?: string | null) => string;
};

export function ClosedLoopEventList({ events, formatTime, localizeBackendText }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="problem-empty-state">
        <div className="problem-empty-icon">📋</div>
        <div className="problem-empty-text">暂无处置闭环事件</div>
      </div>
    );
  }

  return (
    <div className="closed-loop-list">
      {events.map((event) => {
        const isExpanded = expandedIds.has(event.id);
        const statusClass = event.status === 'resolved' ? 'loop-resolved' : event.status === 'open' ? 'loop-open' : 'loop-in-progress';
        const iconClass = event.status === 'resolved' ? 'icon-resolved' : event.status === 'open' ? 'icon-open' : 'icon-in-progress';
        const badgeClass = event.status === 'resolved' ? 'badge-resolved' : event.status === 'open' ? 'badge-open' : 'badge-in-progress';
        const statusText = event.status === 'resolved' ? '已闭环' : event.status === 'open' ? '待处理' : '处理中';
        const icon = event.status === 'resolved' ? '✓' : event.status === 'open' ? '!' : '⋯';

        return (
          <article key={event.id} className={`closed-loop-card ${statusClass}`}>
            <div className="closed-loop-header" onClick={() => toggle(event.id)}>
              <div className="closed-loop-header-left">
                <div className={`closed-loop-icon ${iconClass}`}>{icon}</div>
                <div className="closed-loop-title-group">
                  <div className="closed-loop-title">{localizeBackendText(event.title)}</div>
                  <div className="closed-loop-date">{event.date}</div>
                </div>
              </div>
              <span className={`closed-loop-status-badge ${badgeClass}`}>{statusText}</span>
            </div>

            {isExpanded && (
              <div className="closed-loop-steps">
                {event.trigger && (
                  <div className="closed-loop-step">
                    <div className="closed-loop-step-dot dot-trigger">1</div>
                    <div className="closed-loop-step-content">
                      <div className="closed-loop-step-label">触发</div>
                      <div className="closed-loop-step-text">{localizeBackendText(event.trigger.description)}</div>
                      <div className="closed-loop-step-time">{formatTime(event.trigger.time)}</div>
                    </div>
                  </div>
                )}

                {event.systemJudgment && (
                  <div className="closed-loop-step">
                    <div className="closed-loop-step-dot dot-system">2</div>
                    <div className="closed-loop-step-content">
                      <div className="closed-loop-step-label">系统判断</div>
                      <div className="closed-loop-step-text">{event.systemJudgment}</div>
                    </div>
                  </div>
                )}

                {event.task && (
                  <div className="closed-loop-step">
                    <div className="closed-loop-step-dot dot-task">3</div>
                    <div className="closed-loop-step-content">
                      <div className="closed-loop-step-label">任务</div>
                      <div className="closed-loop-step-text">{localizeBackendText(event.task.title)}</div>
                      <div className="closed-loop-step-time">{formatTime(event.task.time)}</div>
                    </div>
                  </div>
                )}

                {event.action && (
                  <div className="closed-loop-step">
                    <div className="closed-loop-step-dot dot-action">4</div>
                    <div className="closed-loop-step-content">
                      <div className="closed-loop-step-label">处理</div>
                      <div className="closed-loop-step-text">{localizeBackendText(event.action.description)}</div>
                      <div className="closed-loop-step-time">{formatTime(event.action.time)}</div>
                    </div>
                  </div>
                )}

                {event.result && (
                  <div className="closed-loop-step">
                    <div className="closed-loop-step-dot dot-result">5</div>
                    <div className="closed-loop-step-content">
                      <div className="closed-loop-step-label">结果</div>
                      <div className="closed-loop-step-text">{event.result}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
