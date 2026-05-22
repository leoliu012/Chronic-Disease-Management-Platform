import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { NurseDashboardPage } from './pages/NurseDashboardPage';
import { PatientBindingReviewPage } from './pages/PatientBindingReviewPage';
import { ClinicalRulesPage } from './pages/ClinicalRulesPage';
import { IntegrationCenterPage } from './pages/IntegrationCenterPage';
import { PatientTaskProcessingPage } from './pages/PatientTaskProcessingPage';
import { TaskFollowUpRedirect } from './pages/TaskFollowUpRedirect';
import { HospitalVisitRemindersPage } from './pages/HospitalVisitRemindersPage';
import {
  LoginPage,
  getRoleLabel,
  normalizeCurrentUser,
  type CurrentUser,
  type UserRole,
} from './pages/LoginPage';
import { AUTH_TOKEN_STORAGE_KEY, AUTH_USER_STORAGE_KEY } from './api/client';
import { manualLogout, SESSION_EXPIRED_EVENT } from './api/auth-session';
import { OperationToastHost } from './components/OperationToastHost';

type NavItem = {
  to: string;
  label: string;
  hint: string;
  roles: UserRole[];
};

const navItems: NavItem[] = [
  {
    to: '/',
    label: '运营总览',
    hint: '质控 / 管理驾驶舱',
    roles: ['ADMIN', 'MANAGER'],
  },
  {
    to: '/nurse-dashboard',
    label: '护士工作台',
    hint: '待处理事项 / 电话随访',
    roles: ['ADMIN', 'NURSE'],
  },
  {
    to: '/patients',
    label: '患者档案',
    hint: '慢病患者主索引',
    roles: ['ADMIN', 'DOCTOR', 'NURSE'],
  },
  {
    to: '/patient-bindings',
    label: '绑定审核',
    hint: '患者端身份核验',
    roles: ['ADMIN', 'NURSE'],
  },
  {
    to: '/clinical-rules',
    label: '规则配置',
    hint: '病种模板 / 风险阈值',
    roles: ['ADMIN', 'DOCTOR', 'NURSE'],
  },
  {
    to: '/integrations',
    label: '接口中心',
    hint: 'HIS / EMR / LIS 同步',
    roles: ['ADMIN', 'MANAGER'],
  },
];

const roleHomePath: Record<UserRole, string> = {
  ADMIN: '/',
  MANAGER: '/',
  NURSE: '/nurse-dashboard',
  DOCTOR: '/patients',
};

const roleScopeText: Record<UserRole, string[]> = {
  ADMIN: ['查看运营总览', '进入护士工作台', '管理患者档案', '审核患者端绑定', '配置病种规则/风险阈值', '管理 HIS/EMR/LIS 接口中心', '执行系统管理操作'],
  MANAGER: ['查看运营总览和质控指标', '只读查看接口同步状态', '不直接进入患者医疗数据编辑入口'],
  NURSE: ['处理随访/预警/待办', '查看并维护患者慢病档案', '审核患者端绑定', '只读查看病种规则', '不显示管理驾驶舱入口'],
  DOCTOR: ['查看患者档案和风险趋势', '只读查看病种规则', '不显示护士批量待办入口', '不显示管理驾驶舱入口'],
};

function readStoredUser() {
  const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    const normalized = normalizeCurrentUser(JSON.parse(raw));
    if (!normalized) {
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return null;
  }
}

function hasAccess(user: CurrentUser, item: NavItem) {
  return item.roles.includes(user.role);
}

function RoleRoute({
  user,
  roles,
  children,
}: {
  user: CurrentUser;
  roles: UserRole[];
  children: ReactNode;
}) {
  if (!roles.includes(user.role)) {
    return <Navigate to={roleHomePath[user.role] ?? '/login'} replace />;
  }

  return <>{children}</>;
}

function AuthenticatedShell({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => hasAccess(user, item)),
    [user],
  );
  const fallbackPath = visibleNavItems[0]?.to ?? roleHomePath[user.role] ?? '/patients';

  return (
    <div className="hospital-shell auth-shell">
      <aside className="hospital-sidebar">
        <div className="hospital-brand">
          <div className="hospital-logo">医</div>
          <div>
            <div className="hospital-name">智慧慢病管理平台</div>
            <div className="hospital-subtitle">医院慢病中心 · 权限演示版</div>
          </div>
        </div>

        <nav className="hospital-nav" aria-label="主导航">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                isActive ? 'nav-item nav-item-active' : 'nav-item'
              }
            >
              <span className="nav-label">{item.label}</span>
              <span className="nav-hint">{item.hint}</span>
            </NavLink>
          ))}
        </nav>

        <div className="role-scope-card">
          <div className="sidebar-footer-title">当前角色菜单范围</div>
          <div className="role-scope-name">{getRoleLabel(user.role)}</div>
          <ul className="role-scope-list">
            {roleScopeText[user.role].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="sidebar-footer security-sidebar-footer">
          <div className="sidebar-footer-title">权限与合规状态</div>
          <div className="status-dot-row">
            <span className="status-dot status-dot-ok" /> JWT 登录已启用
          </div>
          <div className="status-dot-row">
            <span className="status-dot status-dot-ok" /> 患者列表默认脱敏
          </div>
          <div className="status-dot-row">
            <span className="status-dot status-dot-warn" /> 当前角色：{getRoleLabel(user.role)}
          </div>
        </div>
      </aside>

      <div className="hospital-main-area">
        <header className="topbar">
          <div>
            <div className="topbar-title">某某市人民医院慢病中心</div>
            <div className="topbar-subtitle">
              医防融合 · 权限分级 · 操作留痕 · 高危患者闭环管理
            </div>
          </div>
          <div className="topbar-actions">
            <span className="topbar-pill">内网演示环境</span>
            <span className="topbar-user">
              当前用户：{user.displayName} / {getRoleLabel(user.role)}
            </span>
            <button className="ghost-btn topbar-logout" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route
              path="/"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'MANAGER']}>
                  <OverviewPage />
                </RoleRoute>
              }
            />
            <Route
              path="/nurse-dashboard"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'NURSE']}>
                  <NurseDashboardPage />
                </RoleRoute>
              }
            />
            <Route
              path="/patient-bindings"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'NURSE']}>
                  <PatientBindingReviewPage />
                </RoleRoute>
              }
            />
            <Route
              path="/clinical-rules"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <ClinicalRulesPage user={user} />
                </RoleRoute>
              }
            />

            <Route
              path="/integrations"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'MANAGER']}>
                  <IntegrationCenterPage user={user} />
                </RoleRoute>
              }
            />

            <Route
              path="/hospital-visit-reminders"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <HospitalVisitRemindersPage user={user} />
                </RoleRoute>
              }
            />
            <Route
              path="/patients"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <PatientsPage />
                </RoleRoute>
              }
            />
            <Route
              path="/patients/:patientId/task-processing"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <PatientTaskProcessingPage />
                </RoleRoute>
              }
            />
            <Route
              path="/patients/:patientId/tasks/:taskId/follow-up"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'NURSE']}>
                  <TaskFollowUpRedirect />
                </RoleRoute>
              }
            />
            <Route
              path="/patients/:patientId"
              element={
                <RoleRoute user={user} roles={['ADMIN', 'DOCTOR', 'NURSE']}>
                  <PatientDetailPage />
                </RoleRoute>
              }
            />
            <Route path="/login" element={<Navigate to={fallbackPath} replace />} />
            <Route path="*" element={<Navigate to={fallbackPath} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppContent() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => readStoredUser());

  // Bridge from the axios layer to React state.
  //
  // The axios 401 interceptor in `api/client.ts` calls
  // `clearSession()` (in `api/auth-session.ts`), which dispatches
  // this window event. We translate it into a React state update so
  // the existing `if (!currentUser)` branch below kicks in and renders
  // the login routes. The matching `<Route path="*" element={<Navigate
  // to="/login" replace />} />` then updates the URL without a full
  // page reload, preserving in-memory state in unrelated components.
  useEffect(() => {
    function handle() {
      setCurrentUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handle);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handle);
    };
  }, []);

  function logout() {
    // `manualLogout` clears localStorage + dispatches SESSION_EXPIRED.
    // The listener above will set currentUser to null. Calling
    // setCurrentUser(null) directly here too is harmless and keeps the
    // logout button feeling synchronous.
    manualLogout();
    setCurrentUser(null);
  }

  if (!currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={setCurrentUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <AuthenticatedShell user={currentUser} onLogout={logout} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
      <OperationToastHost />
    </BrowserRouter>
  );
}
