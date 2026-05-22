/**
 * Centralized session-expired handling.
 *
 * The HTTP layer can't know about React state, and React can't easily
 * tap into an axios interceptor without circular wiring. This module
 * sits between the two as a tiny event bus.
 *
 * Flow on 401:
 *
 *   axios 401 interceptor
 *     → clearSession({ code, message })
 *         · stashes return path + reason in sessionStorage (survives
 *           the soft route change, dies on tab close)
 *         · clears auth tokens from localStorage
 *         · emits one `session-expired` window event, even if N
 *           parallel requests all 401 at once
 *     → React root listens, calls setCurrentUser(null)
 *     → App switches to LoginPage (via the existing
 *       `if (!currentUser)` branch)
 *
 * After successful re-login:
 *
 *   LoginPage
 *     → consumeReturnPath() / consumeExpiryReason()
 *     → restores URL via history.replaceState before calling onLogin
 *     → AuthenticatedShell mounts, react-router matches the URL
 */

import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  emitOperationNotice,
} from './client';

/** Event fired on the global `window` when the session must end. */
export const SESSION_EXPIRED_EVENT = 'session-expired';

/** sessionStorage keys — cleared on tab close, not localStorage. */
const RETURN_PATH_KEY = 'chronic_care_post_login_redirect';
const EXPIRY_REASON_KEY = 'chronic_care_session_expiry_reason';

/** Backend exception `code` values that map to "session must end". */
export type SessionExpiryCode =
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'TOKEN_VERIFICATION_FAILED'
  | 'NO_TOKEN'
  | 'UNKNOWN';

export type SessionExpiryDetail = {
  code: SessionExpiryCode;
  /** Human-readable message; may be shown to the user. */
  message: string;
};

/**
 * One-shot guard. While true, subsequent calls to `clearSession`
 * within the same tick / event-loop turn are no-ops. Reset on next
 * macrotask so that a fresh expiry after re-login still fires.
 */
let clearInFlight = false;

/** Reject anything that isn't a same-origin path. */
function sanitizeReturnPath(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (!raw.startsWith('/')) return null;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login#')) return null;
  return raw;
}

function defaultMessageFor(code: SessionExpiryCode): string {
  switch (code) {
    case 'TOKEN_EXPIRED':
      return '登录已过期，请重新登录。';
    case 'INVALID_TOKEN':
    case 'TOKEN_VERIFICATION_FAILED':
      return '登录凭据无效，请重新登录。';
    case 'NO_TOKEN':
      return '请先登录。';
    default:
      return '登录状态已失效，请重新登录。';
  }
}

/**
 * Clear all client-side session state and notify React.
 * Safe to call multiple times — only the first call in a burst does work.
 */
export function clearSession(input: Partial<SessionExpiryDetail> = {}) {
  if (clearInFlight) return;
  clearInFlight = true;

  const code: SessionExpiryCode = (input.code as SessionExpiryCode) ?? 'UNKNOWN';
  const message = input.message?.trim() || defaultMessageFor(code);

  // 1. Remember where the user was, so we can route them back after re-login.
  try {
    const path = window.location.pathname + window.location.search + window.location.hash;
    const safePath = sanitizeReturnPath(path);
    if (safePath) {
      sessionStorage.setItem(RETURN_PATH_KEY, safePath);
    }
  } catch {
    // sessionStorage can throw under storage-disabled / privacy mode; ignore.
  }

  // 2. Remember why, for the banner on the LoginPage.
  try {
    sessionStorage.setItem(EXPIRY_REASON_KEY, JSON.stringify({ code, message }));
  } catch {
    /* ignore */
  }

  // 3. Surface a one-shot toast so users currently watching see immediately.
  emitOperationNotice({
    type: 'warning',
    title: '需要重新登录',
    message,
    operationKey: 'session-expired',
  });

  // 4. Clear auth credentials from localStorage.
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    /* ignore */
  }

  // 5. Tell React. The root component re-renders to <LoginPage />, and the
  //    existing `<Route path="*" element={<Navigate to="/login" replace />} />`
  //    branch updates the URL to /login.
  try {
    window.dispatchEvent(
      new CustomEvent<SessionExpiryDetail>(SESSION_EXPIRED_EVENT, {
        detail: { code, message },
      }),
    );
  } catch {
    /* ignore — older browsers without CustomEvent constructor */
  }

  // Reset the guard on the next macrotask so a future expiry still triggers.
  setTimeout(() => {
    clearInFlight = false;
  }, 500);
}

/**
 * Used by LoginPage on successful login. Returns the path the user
 * was on when their session expired, or `null` if there's nothing to
 * restore. Removes the entry so a subsequent login doesn't reuse it.
 */
export function consumeReturnPath(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(RETURN_PATH_KEY);
    return raw ? sanitizeReturnPath(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Used by LoginPage to display a banner explaining why the user is
 * back at /login. Returns the reason and removes it from storage.
 */
export function consumeExpiryReason(): SessionExpiryDetail | null {
  try {
    const raw = sessionStorage.getItem(EXPIRY_REASON_KEY);
    sessionStorage.removeItem(EXPIRY_REASON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionExpiryDetail;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      code: (parsed.code as SessionExpiryCode) ?? 'UNKNOWN',
      message: String(parsed.message ?? defaultMessageFor(parsed.code ?? 'UNKNOWN')),
    };
  } catch {
    return null;
  }
}

/**
 * Called by the user explicitly hitting "退出登录". Same effect as
 * an expiry, minus the banner and toast.
 */
export function manualLogout() {
  try {
    sessionStorage.removeItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(EXPIRY_REASON_KEY);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    /* ignore */
  }

  try {
    window.dispatchEvent(
      new CustomEvent<SessionExpiryDetail>(SESSION_EXPIRED_EVENT, {
        detail: { code: 'NO_TOKEN', message: '' },
      }),
    );
  } catch {
    /* ignore */
  }
}
