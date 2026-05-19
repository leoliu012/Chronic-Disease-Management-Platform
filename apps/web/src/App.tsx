import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { NurseDashboardPage } from './pages/NurseDashboardPage';

const navItems = [
  { to: '/', label: '运营总览', hint: '质控 / 管理驾驶舱' },
  { to: '/nurse-dashboard', label: '护士工作台', hint: '随访 / 预警 / 待办' },
  { to: '/patients', label: '患者档案', hint: '慢病患者主索引' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="hospital-shell">
        <aside className="hospital-sidebar">
          <div className="hospital-brand">
            <div className="hospital-logo">医</div>
            <div>
              <div className="hospital-name">智慧慢病管理平台</div>
              <div className="hospital-subtitle">医院慢病中心 · 试点版</div>
            </div>
          </div>

          <nav className="hospital-nav" aria-label="主导航">
            {navItems.map((item) => (
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

          <div className="sidebar-footer">
            <div className="sidebar-footer-title">院内系统对接状态</div>
            <div className="status-dot-row">
              <span className="status-dot status-dot-ok" /> HIS / EMR 模拟接入
            </div>
            <div className="status-dot-row">
              <span className="status-dot status-dot-warn" /> LIS / 微信小程序待接入
            </div>
          </div>
        </aside>

        <div className="hospital-main-area">
          <header className="topbar">
            <div>
              <div className="topbar-title">某某市人民医院慢病中心</div>
              <div className="topbar-subtitle">
                医防融合 · 护士长期随访 · 高危患者筛查 · 复诊闭环管理
              </div>
            </div>
            <div className="topbar-actions">
              <span className="topbar-pill">内网演示环境</span>
              <span className="topbar-user">当前用户：护士长 / 慢病管理师</span>
            </div>
          </header>

          <main className="main">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/nurse-dashboard" element={<NurseDashboardPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/patients/:patientId" element={<PatientDetailPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
