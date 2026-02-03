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
  const brandName = branding.name || '水電派工系統';
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
          aria-label="主題模式"
        >
          <option value="light">淺色</option>
          <option value="dark">深色</option>
          <option value="system">系統</option>
        </select>
        <nav className="header-nav">
          <Link to="/">任務列表</Link>
          <Link to="/overview">今日派工</Link>
          <Link to="/stats">工時效率</Link>
          <Link to="/calendar">排程總覽</Link>
          {isAdmin ? <Link to="/admin">管理中心</Link> : null}
          <Link to="/profile">個人設定</Link>
        </nav>
        <span>
          目前登入：{user?.username}（{labels[user?.role] || user?.role}）
        </span>
        <button type="button" onClick={logout}>
          登出
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
