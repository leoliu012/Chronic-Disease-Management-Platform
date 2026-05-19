import { useEffect, useMemo, useState } from 'react';
import type { ApiConnectionErrorDetail, OperationNoticeDetail } from '../api/client';

const MAX_TOASTS = 4;
const AUTO_DISMISS_MS = 5200;

type ToastItem = OperationNoticeDetail & {
  id: string;
  createdAt: number;
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeApiConnectionError(detail: ApiConnectionErrorDetail): OperationNoticeDetail {
  return {
    type: 'error',
    title: '后端连接异常',
    message: `${detail.message}${detail.status ? `（HTTP ${detail.status}）` : ''}`,
  };
}

export function OperationToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function push(detail: OperationNoticeDetail) {
      const item: ToastItem = {
        ...detail,
        id: makeId(detail.type),
        createdAt: Date.now(),
      };

      setItems((current) => [item, ...current].slice(0, MAX_TOASTS));

      window.setTimeout(() => {
        setItems((current) => current.filter((toast) => toast.id !== item.id));
      }, AUTO_DISMISS_MS);
    }

    function handleOperationNotice(event: Event) {
      const detail = (event as CustomEvent<OperationNoticeDetail>).detail;
      if (!detail?.message) return;
      push(detail);
    }

    function handleApiConnectionError(event: Event) {
      const detail = (event as CustomEvent<ApiConnectionErrorDetail>).detail;
      if (!detail?.message) return;
      push(normalizeApiConnectionError(detail));
    }

    window.addEventListener('operation-notice', handleOperationNotice);
    window.addEventListener('api-connection-error', handleApiConnectionError);

    return () => {
      window.removeEventListener('operation-notice', handleOperationNotice);
      window.removeEventListener('api-connection-error', handleApiConnectionError);
    };
  }, []);

  const groupedItems = useMemo(() => items, [items]);

  if (groupedItems.length === 0) return null;

  return (
    <div className="operation-toast-host" aria-live="polite" aria-atomic="false">
      {groupedItems.map((item) => (
        <div key={item.id} className={`operation-toast operation-toast-${item.type}`} role="status">
          <div className="operation-toast-icon" aria-hidden="true">
            {item.type === 'success' ? '✓' : item.type === 'warning' ? '!' : item.type === 'error' ? '×' : 'i'}
          </div>
          <div className="operation-toast-body">
            <strong>{item.title}</strong>
            <span>{item.message}</span>
          </div>
          <button
            className="operation-toast-close"
            type="button"
            aria-label="关闭提示"
            onClick={() => setItems((current) => current.filter((toast) => toast.id !== item.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
