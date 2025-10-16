import { Link } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';
import { roleLabels } from '../constants/roles.js';

const AppHeader = ({ title, subtitle, children }) => {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <header className="page-header">
      <div className="page-header__titles">
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        {children}
      </div>
      <div className="header-actions">
        <nav className="header-nav">
          <Link to="/">任務列表</Link>
          {isAdmin ? <Link to="/admin">使用者管理</Link> : null}
          <Link to="/profile">個人資料</Link>
        </nav>
        <span>
          目前登入：{user?.username}（{roleLabels[user?.role] || user?.role}）
        </span>
        <button type="button" onClick={logout}>
          登出
        </button>
      </div>
    </header>
  );
};

export default AppHeader;
