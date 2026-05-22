import { useEffect } from 'react';

/**
 * Prominent feedback message system.
 *
 * Every operation success, failure, and required-field-missing prompt
 * should route through these helpers instead of inline top-of-page notice
 * banners, `window.alert(...)`, antd `message.*` / `notification.*`, or any
 * other default message UI.
 *
 * Messages are rendered by <OperationToastHost /> (see
 * apps/web/src/components/OperationToastHost.tsx) as CENTERED PROMINENT
 * MESSAGE BOXES — not page-top notice bars.
 */

export type FeedbackTone = 'success' | 'error' | 'warning' | 'info';

export type FeedbackMessageDetail = {
  tone: FeedbackTone;
  title: string;
  message: string;
  detail?: string;
};

export const FEEDBACK_MESSAGE_EVENT = 'feedback-message';

export function showFeedbackMessage(detail: FeedbackMessageDetail) {
  if (typeof window === 'undefined') return;
  if (!detail?.message) return;
  window.dispatchEvent(
    new CustomEvent<FeedbackMessageDetail>(FEEDBACK_MESSAGE_EVENT, { detail }),
  );
}

export function showFeedbackSuccess(message: string, title = '操作成功', detail?: string) {
  showFeedbackMessage({ tone: 'success', title, message, detail });
}

export function showFeedbackError(message: string, title = '操作失败', detail?: string) {
  showFeedbackMessage({ tone: 'error', title, message, detail });
}

export function showFeedbackWarning(message: string, title = '请注意', detail?: string) {
  showFeedbackMessage({ tone: 'warning', title, message, detail });
}

export function showFeedbackInfo(message: string, title = '提示', detail?: string) {
  showFeedbackMessage({ tone: 'info', title, message, detail });
}

/**
 * 必填项缺失专用提示。视觉上等同 warning，但标题更明确，护士/医生
 * 一眼就知道是"必填没填"，不是"操作失败"。
 */
export function showRequiredFieldMissing(
  message: string,
  title = '必填项未填写',
  detail?: string,
) {
  showFeedbackMessage({ tone: 'warning', title, message, detail });
}

const FAILURE_HINTS = /失败|错误|无法|拒绝|没有权限|缺少|缺失|超时|不允许/;

/**
 * Heuristically pick success vs error tone for pages that conflate success
 * and failure into a single `setMessage` state (e.g. ClinicalRulesPage).
 */
export function showFeedbackInferred(message: string) {
  if (!message) return;
  if (FAILURE_HINTS.test(message)) {
    showFeedbackError(message);
  } else {
    showFeedbackSuccess(message);
  }
}

/**
 * Bridges existing `[message, error]` React state pairs into the prominent
 * message box system. Drop-in replacement for inline top-of-page notice
 * banners.
 *
 * Usage:
 *   const [message, setMessage] = useState('');
 *   const [error, setError] = useState('');
 *   useFeedbackMessageBridge(message, error);
 */
export function useFeedbackMessageBridge(message?: string, error?: string) {
  useEffect(() => {
    if (message) showFeedbackSuccess(message);
  }, [message]);

  useEffect(() => {
    if (error) showFeedbackError(error);
  }, [error]);
}

/**
 * For pages where a single state field is used for both success and error
 * messages (rules / integration center).
 */
export function useFeedbackInferredBridge(message?: string) {
  useEffect(() => {
    if (message) showFeedbackInferred(message);
  }, [message]);
}
