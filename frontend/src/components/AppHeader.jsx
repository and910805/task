import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

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
  const location = useLocation();

  const isAdmin = user?.role === 'admin';
  const brandName = branding.name || 'TaskGo';
  const logoSrc = branding.logoUrl || brandFallback;
  const roleLabel = labels[user?.role] || user?.role || '';

  const navGroups = useMemo(
    () => [
      {
        id: 'ops',
        label: '\u73fe\u5834\u4f5c\u696d',
        hint: '\u4efb\u52d9\u8207\u6392\u7a0b',
        items: [
          { to: '/app', label: '\u4efb\u52d9\u6e05\u55ae', exact: true },
          { to: '/attendance', label: '\u51fa\u52e4\u4e2d\u5fc3', exact: true },
          { to: '/calendar', label: '\u884c\u4e8b\u66c6', exact: true },
        ],
      },
      {
        id: 'crm',
        label: 'CRM / \u696d\u52d9',
        hint: '\u5ba2\u6236\u8207\u5831\u50f9',
        items: [
          { to: '/crm', label: '\u7d93\u71df\u7ba1\u7406\u9996\u9801', exact: true },
          { to: '/crm/customers', label: '\u5ba2\u6236\u7ba1\u7406', exact: true },
          { to: '/crm/contacts', label: '\u806f\u7d61\u4eba\u7ba1\u7406', exact: true },
          { to: '/crm/quotes', label: '\u5831\u50f9\u55ae', exact: true },
          { to: '/crm/catalog', label: '\u50f9\u76ee\u8cc7\u6599\u5eab', exact: true },
          { to: '/crm/bookings', label: '\u7db2\u7ad9\u9810\u7d04', exact: true },
        ],
      },
      {
        id: 'reports',
        label: '\u5831\u8868 / \u5eab\u5b58',
        hint: '\u5206\u6790\u8207\u6750\u6599',
        items: [
          { to: '/reports', label: '\u5831\u8868\u4e2d\u5fc3', exact: true },
          { to: '/materials/purchases', label: '\u6750\u6599\u63a1\u8cfc', managerOnly: true, exact: true },
          { to: '/materials/reports', label: '\u8017\u6750\u6708\u7d50\u5831\u8868', managerOnly: true, exact: true },
        ],
      },
      {
        id: 'system',
        label: '\u7cfb\u7d71\u8a2d\u5b9a',
        hint: '\u5e33\u865f\u8207\u7ba1\u7406',
        items: [
          { to: '/profile', label: '\u500b\u4eba\u8a2d\u5b9a', exact: true },
          { to: '/admin', label: '\u7ba1\u7406\u5f8c\u53f0', adminOnly: true, exact: true },
        ],
      },
    ],
    [],
  );

  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.managerOnly && user?.role === 'worker') return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  const isItemActive = (item) => (item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to));
  const activeGroupId =
    visibleNavGroups.find((group) => group.items.some((item) => isItemActive(item)))?.id || visibleNavGroups[0]?.id || '';

  const [openGroups, setOpenGroups] = useState({});

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = {};
      visibleNavGroups.forEach((group) => {
        next[group.id] = prev[group.id] ?? group.id === activeGroupId;
      });
      if (activeGroupId) {
        next[activeGroupId] = true;
      }
      return next;
    });
  }, [activeGroupId, visibleNavGroups]);

  const toggleGroup = (groupId) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <>
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__logo">
            <img src={logoSrc} alt={`${brandName} Logo`} />
          </div>
          <div className="app-sidebar__brand-meta">
            <strong>{brandName}</strong>
            <span>{'\u71df\u904b\u7cfb\u7d71'}</span>
          </div>
        </div>

        <nav className="app-sidebar__nav">
          <GlobalSearch />
          <div className="app-sidebar__groups">
            {visibleNavGroups.map((group) => {
              const isGroupActive = group.items.some((item) => isItemActive(item));
              const isOpen = Boolean(openGroups[group.id]);
              return (
                <section
                  key={group.id}
                  className={`app-sidebar__group${isGroupActive ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="app-sidebar__group-toggle"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="app-sidebar__group-copy">
                      <strong>{group.label}</strong>
                      <small>{group.hint}</small>
                    </span>
                    <span className="app-sidebar__group-icon">{isOpen ? '-' : '+'}</span>
                  </button>
                  {isOpen ? (
                    <div className="app-sidebar__group-links">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={Boolean(item.exact)}
                          className={({ isActive }) => `app-sidebar__link app-sidebar__sublink${isActive ? ' is-active' : ''}`}
                        >
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </nav>

        <div className="app-sidebar__footer">
          <SidebarOwnerOrb logoSrc={logoSrc} text={user?.username || 'eric'} />
          <p className="app-sidebar__user">
            {'\u76ee\u524d\u767b\u5165\uff1a'}
            {user?.username}
            {roleLabel ? `\uff08${roleLabel}\uff09` : ''}
          </p>
          <div className="app-sidebar__controls">
            <select
              className="theme-toggle app-sidebar__theme-select"
              value={preference}
              onChange={(event) => setPreference(event.target.value)}
              aria-label={'\u4e3b\u984c\u5207\u63db'}
            >
              <option value="light">{'\u6dfa\u8272'}</option>
              <option value="dark">{'\u6df1\u8272'}</option>
              <option value="system">{'\u8ddf\u96a8\u7cfb\u7d71'}</option>
            </select>
            <button type="button" className="secondary-button" onClick={logout}>
              {'\u767b\u51fa'}
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
