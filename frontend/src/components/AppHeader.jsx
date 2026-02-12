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
  const brandName = branding.name || '蝡?瘞湧銵?;
  const logoSrc = branding.logoUrl || brandFallback;

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
          aria-label="??銝駁?璅∪?"
        >
          <option value="light">?儭?Light</option>
          <option value="dark">?? Dark</option>
          <option value="system">? System</option>
        </select>
        <nav className="header-nav">
          <Link to="/">隞餃??”</Link>
          <Link to="/calendar">??閬?</Link>
          <Link to="/crm">CRM</Link>
          {isAdmin ? <Link to="/admin">雿輻?恣??/Link> : null}
          <Link to="/profile">?犖鞈?</Link>
        </nav>
        <span>
          ?桀??餃嚗?
          {user?.username}
          嚗labels[user?.role] || user?.role}嚗?
        </span>
        <button type="button" onClick={logout}>
          ?餃
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
