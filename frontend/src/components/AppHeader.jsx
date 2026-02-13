import { NavLink } from 'react-router-dom';

import brandFallback from '../assets/brand-logo.svg';
import GlobalSearch from './GlobalSearch.jsx';
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
    { to: '/reports', label: '報表' },
    { to: '/profile', label: '個人設定' },
    { to: '/admin', label: '管理後台', adminOnly: true },
  ];
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <>
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__logo">
            <img src={logoSrc} alt={`${brandName} Logo`} />
          </div>
          <div className="app-sidebar__brand-meta">
            <strong>{brandName}</strong>
            <span>Operations Suite</span>
          </div>
        </div>

        <nav className="app-sidebar__nav">
          <GlobalSearch />
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                `app-sidebar__link${isActive ? ' is-active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="app-sidebar__footer">
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
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
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
