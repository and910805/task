import { Link } from 'react-router-dom';

import brandFallback from '../assets/brand-logo.svg';
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

  return (
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

        <select
          className="theme-toggle"
          value={preference}
          onChange={(event) => setPreference(event.target.value)}
          aria-label="主題切換"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>

        <nav className="header-nav">
          <Link to="/">任務清單</Link>
          <Link to="/calendar">行事曆</Link>
          <Link to="/crm">CRM</Link>
          {isAdmin ? <Link to="/admin">管理後台</Link> : null}
          <Link to="/profile">個人設定</Link>
        </nav>

        <span>
          目前登入：{user?.username}
          {roleLabel ? `（${roleLabel}）` : ''}
        </span>

        <button type="button" onClick={logout}>
          登出
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
