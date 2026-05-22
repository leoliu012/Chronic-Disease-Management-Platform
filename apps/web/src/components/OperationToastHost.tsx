import { useEffect, useState } from 'react';
import type { ApiConnectionErrorDetail, OperationNoticeDetail } from '../api/client';
import type { FeedbackMessageDetail } from '../utils/feedbackMessage';

const MAX_ITEMS = 3;
const AUTO_DISMISS_MS = 5200;
const DEDUPE_WINDOW_MS = 900;

type Tone = 'success' | 'error' | 'warning' | 'info';

type ToastItem = {
  id: string;
  tone: Tone;
  title: string;
  message: string;
  detail?: string;
  createdAt: number;
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldAutoDismiss(tone: Tone) {
  // 成功 / info 自动消失；错误和"必填缺失"等告警必须由用户主动关闭，避免被看漏。
  return tone === 'success' || tone === 'info';
}

/**
 * Prominent centered message box host.
 *
 * Listens to three event channels (all dispatched to `window`):
 *   - `operation-notice`        — emitted by api/client.ts for axios success/error
 *   - `api-connection-error`    — emitted by api/client.ts for transport errors
 *   - `feedback-message`        — emitted by utils/feedbackMessage helpers
 *
 * Every message renders as a CENTERED prominent message box (NOT a top-of-page
 * notice bar). The host must be mounted exactly once at the app root.
 */
export function OperationToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function push(seed: Omit<ToastItem, 'id' | 'createdAt'>) {
      const next: ToastItem = {
        ...seed,
        id: makeId(seed.tone),
        createdAt: Date.now(),
      };

      setItems((current) => {
        const cutoff = Date.now() - DEDUPE_WINDOW_MS;
        const deduped = current.filter(
          (existing) =>
            existing.createdAt < cutoff ||
            existing.tone !== next.tone ||
            existing.title !== next.title ||
            existing.message !== next.message,
        );
        return [next, ...deduped].slice(0, MAX_ITEMS);
      });

      if (shouldAutoDismiss(next.tone)) {
        window.setTimeout(() => {
          setItems((current) => current.filter((item) => item.id !== next.id));
        }, AUTO_DISMISS_MS);
      }
    }

    function handleOperationNotice(event: Event) {
      const detail = (event as CustomEvent<OperationNoticeDetail>).detail;
      if (!detail?.message) return;
      push({
        tone: detail.type,
        title: detail.title,
        message: detail.message,
      });
    }

    function handleApiConnectionError(event: Event) {
      const detail = (event as CustomEvent<ApiConnectionErrorDetail>).detail;
      if (!detail?.message) return;
      push({
        tone: 'error',
        title: '后端连接异常',
        message: `${detail.message}${detail.status ? `（HTTP ${detail.status}）` : ''}`,
      });
    }

    function handleFeedbackMessage(event: Event) {
      const detail = (event as CustomEvent<FeedbackMessageDetail>).detail;
      if (!detail?.message) return;
      push({
        tone: detail.tone,
        title: detail.title,
        message: detail.message,
        detail: detail.detail,
      });
    }

    window.addEventListener('operation-notice', handleOperationNotice);
    window.addEventListener('api-connection-error', handleApiConnectionError);
    window.addEventListener('feedback-message', handleFeedbackMessage);

    return () => {
      window.removeEventListener('operation-notice', handleOperationNotice);
      window.removeEventListener('api-connection-error', handleApiConnectionError);
      window.removeEventListener('feedback-message', handleFeedbackMessage);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="operation-toast-host" aria-live="polite" aria-atomic="false">
      {items.map((item) => {
        const persistent = !shouldAutoDismiss(item.tone);
        return (
          <div
            key={item.id}
            className={`operation-toast operation-toast-${item.tone}${persistent ? ' operation-toast-persistent' : ''}`}
            role={item.tone === 'error' || item.tone === 'warning' ? 'alert' : 'status'}
          >
            <div className="operation-toast-icon" aria-hidden="true">
              {item.tone === 'success'
                ? '✓'
                : item.tone === 'warning'
                  ? '!'
                  : item.tone === 'error'
                    ? '×'
                    : 'i'}
            </div>
            <div className="operation-toast-body">
              <strong>{item.title}</strong>
              <span>{item.message}</span>
              {item.detail && <em>{item.detail}</em>}
            </div>
            <button
              className="operation-toast-close"
              type="button"
              aria-label="关闭提示"
              onClick={() => setItems((current) => current.filter((it) => it.id !== item.id))}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
