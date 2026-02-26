import { NavLink } from 'react-router-dom';

import brandFallback from '../assets/brand-logo.svg';
import GlobalSearch from './GlobalSearch.jsx';
import SidebarOwnerOrb from './SidebarOwnerOrb.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const AppHeader = ({ title, subtitle, actions = null, children }) => {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const { labels } = useRoleLabels();
  const { preference, setPreference } = useTheme();

  const isAdmin = user?.role === 'admin';
  const brandName = branding.name || 'TaskGo';
  const logoSrc = branding.logoUrl || brandFallback;
  const roleLabel = labels[user?.role] || user?.role || '';
  const navItems = [
    { to: '/app', label: '任務清單' },
    { to: '/attendance', label: '出勤' },
    { to: '/calendar', label: '行事曆' },
    { to: '/crm', label: '營運中台' },
    { to: '/crm/catalog', label: '價目資料庫' },
    { to: '/materials/purchases', label: '耗材入庫', managerOnly: true },
    { to: '/materials/reports', label: '耗材月結', managerOnly: true },
    { to: '/reports', label: '報表' },
    { to: '/profile', label: '個人設定' },
    { to: '/admin', label: '管理後台', adminOnly: true },
  ];
  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.managerOnly && user?.role === 'worker') return false;
    return true;
  });

  return (
    <>
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__logo">
            <img src={logoSrc} alt={`${brandName} Logo`} />
          </div>
          <div className="app-sidebar__brand-meta">
            <strong>{brandName}</strong>
            <span>營運系統</span>
          </div>
        </div>

        <nav className="app-sidebar__nav">
          <GlobalSearch />
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) => `app-sidebar__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <SidebarOwnerOrb logoSrc={logoSrc} text={user?.username || 'eric'} />
          <p className="app-sidebar__user">
            目前登入：{user?.username}
            {roleLabel ? `（${roleLabel}）` : ''}
          </p>
          <div className="app-sidebar__controls">
            <select
              className="theme-toggle app-sidebar__theme-select"
              value={preference}
              onChange={(event) => setPreference(event.target.value)}
              aria-label="主題切換"
            >
              <option value="light">淺色</option>
              <option value="dark">深色</option>
              <option value="system">跟隨系統</option>
            </select>
            <button type="button" className="secondary-button" onClick={logout}>
              登出
            </button>
          </div>
        </div>
      </aside>

      <header className="page-header">
        <div className="page-header__lead">
          <div className="header-brand header-brand--banner">
            <div className="header-brand__logo">
              <img src={logoSrc} alt={`${brandName} Logo`} />
            </div>
            <span className="header-brand__name">{brandName}</span>
          </div>
          <div className="page-header__titles">
            <h1>{title}</h1>
            {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
            {children}
          </div>
        </div>

        <div className="header-actions">
          {actions ? <div className="header-extra">{actions}</div> : null}
        </div>
      </header>
    </>
  );
};

export default AppHeader;
