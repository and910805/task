import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ClipboardList, PlusCircle, Sun, UserRound } from 'lucide-react';

import { useAuth } from '../context/AuthContext.jsx';
import { MANAGER_ROLES } from '../constants/workspace.js';

// Pages with their own bottom controls (task detail tabs) opt out.
const TAB_ROUTES = ['/today', '/tasks', '/dispatch/new', '/profile', '/app', '/team', '/calendar', '/attendance'];

const MobileTabBar = () => {
  const { user } = useAuth();
  const location = useLocation();
  const visible = Boolean(user?.active_workspace_id) && TAB_ROUTES.includes(location.pathname);

  useEffect(() => {
    document.body.classList.toggle('has-tabbar', visible);
    return () => document.body.classList.remove('has-tabbar');
  }, [visible]);

  if (!visible) return null;
  const isManager = MANAGER_ROLES.includes(user?.role);
  const linkClass = ({ isActive }) => (isActive ? 'is-active' : '');

  return (
    <nav className="tg-tabbar" aria-label="主要功能">
      <NavLink to="/today" className={linkClass}>
        <Sun aria-hidden="true" />
        今日
      </NavLink>
      <NavLink to="/tasks" className={linkClass} end>
        <ClipboardList aria-hidden="true" />
        任務
      </NavLink>
      {isManager ? (
        <NavLink to="/dispatch/new" className={linkClass}>
          <PlusCircle aria-hidden="true" />
          派工
        </NavLink>
      ) : null}
      <NavLink to="/profile" className={linkClass}>
        <UserRound aria-hidden="true" />
        我的
      </NavLink>
    </nav>
  );
};

export default MobileTabBar;
