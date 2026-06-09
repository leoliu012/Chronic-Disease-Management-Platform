import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useFeedbackMessageBridge } from '../utils/feedbackMessage';
import {
  api,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  getApiErrorMessage,
} from '../api/client';
import {
  consumeExpiryReason,
  consumeReturnPath,
  type SessionExpiryDetail,
} from '../api/auth-session';
import '../auth-security-v2.css';

export type UserRole = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'MANAGER';

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  hospitalTenantId?: string | null;
};

type LoginResponse = {
  accessToken: string;
  user: unknown;
};

type LoginPageProps = {
  onLogin: (user: CurrentUser) => void;
};

const validRoles: UserRole[] = ['ADMIN', 'DOCTOR', 'NURSE', 'MANAGER'];

const demoAccounts = [
  { username: 'admin', password: 'admin123', label: '系统管理员' },
  { username: 'doctor', password: 'doctor123', label: '医生' },
  { username: 'nurse', password: 'nurse123', label: '护士长' },
  { username: 'manager', password: 'manager123', label: '管理者' },
];

const roleLabelMap: Record<UserRole, string> = {
  ADMIN: '系统管理员',
  DOCTOR: '医生',
  NURSE: '护士 / 慢病管理师',
  MANAGER: '慢病中心管理者',
};

export function normalizeUserRole(value: unknown): UserRole | null {
  const role = String(value ?? '').trim().toUpperCase();
  return validRoles.includes(role as UserRole) ? (role as UserRole) : null;
}

export function normalizeCurrentUser(value: unknown): CurrentUser | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<CurrentUser> & Record<string, unknown>;
  const role = normalizeUserRole(raw.role);

  if (!raw.id || !raw.username || !role) return null;

  return {
    id: String(raw.id),
    username: String(raw.username),
    displayName: String(raw.displayName || raw.username),
    role,
    hospitalTenantId: raw.hospitalTenantId == null ? null : String(raw.hospitalTenantId),
  };
}

export function getRoleLabel(role: UserRole) {
  return roleLabelMap[role] ?? role;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('nurse');
  const [password, setPassword] = useState('nurse123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // prominent-feedback-bridge-v1
  useFeedbackMessageBridge(undefined, error);
  const [expiryReason, setExpiryReason] = useState<SessionExpiryDetail | null>(null);

  // If the user arrived at /login because their previous session
  // expired (rather than by clicking 退出登录 or by opening the app
  // fresh), pull the reason out of sessionStorage and show a banner.
  // `consumeExpiryReason` clears the entry so a deliberate refresh
  // of the login page doesn't keep showing the banner.
  useEffect(() => {
    const reason = consumeExpiryReason();
    if (reason) {
      setExpiryReason(reason);
    }
  }, []);

  async function login(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await api.post<LoginResponse>('/auth/login', {
        username,
        password,
      });

      const normalizedUser = normalizeCurrentUser(res.data.user);
      if (!normalizedUser) {
        throw new Error('登录响应缺少有效角色，请重新执行 node prisma/seed-auth.js');
      }

      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, res.data.accessToken);
      localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(normalizedUser));

      // If we know where the user was when their session expired,
      // restore that URL BEFORE calling onLogin. AuthenticatedShell's
      // Routes will match against the restored pathname on its first
      // render. `replaceState` (not pushState) keeps the back button
      // sensible — the user can't "Back" their way to the login page.
      const returnPath = consumeReturnPath();
      if (returnPath) {
        try {
          window.history.replaceState(window.history.state, '', returnPath);
        } catch {
          // Older browsers / sandboxed iframes: fall through, user
          // just lands on the role's default page instead.
        }
      }

      onLogin(normalizedUser);
    } catch (error) {
      setError(
        getApiErrorMessage(
          error,
          '登录失败。请先执行 npm run demo:init，或检查账号密码 / 角色字段。',
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-logo-row">
          <div className="hospital-logo">医</div>
          <div>
            <div className="hospital-name">智慧慢病管理平台</div>
            <div className="hospital-subtitle">医院可信演示版 · Auth/RBAC/Audit v1</div>
          </div>
        </div>

        <h1>院内账号登录</h1>
        <p>
          演示版已增加 JWT 登录、角色权限、患者敏感信息脱敏、操作审计和生产环境安全限制。
        </p>

        <div className="security-feature-grid">
          <div>统一认证</div>
          <div>医生/护士/管理员权限</div>
          <div>患者隐私脱敏</div>
          <div>审计日志留痕</div>
        </div>
      </section>

      <section className="login-card">
        <div className="section-title-row compact">
          <div>
            <h2>登录慢病中心工作台</h2>
            <p className="muted">默认填入护士演示账号，可切换不同角色查看菜单差异。</p>
          </div>
        </div>

        {expiryReason && (
          <div className="login-session-expired-banner" role="status" aria-live="polite">
            <strong>会话已结束</strong>
            <span>{expiryReason.message}</span>
          </div>
        )}

        <form className="form" onSubmit={login}>
          <label>
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button className="primary-btn login-submit" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录系统'}
          </button>
        </form>

        <div className="demo-account-list">
          <div className="sidebar-footer-title">演示账号</div>
          {demoAccounts.map((account) => (
            <button
              key={account.username}
              className="demo-account-btn"
              type="button"
              onClick={() => {
                setUsername(account.username);
                setPassword(account.password);
              }}
            >
              <span>{account.label}</span>
              <code>{account.username} / {account.password}</code>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}


