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
          {
            to: '/app',
            label: '\u4efb\u52d9\u6e05\u55ae',
            desc: '\u67e5\u770b\u6307\u6d3e\u4efb\u52d9\u3001\u8655\u7406\u9032\u5ea6\u8207\u73fe\u5834\u66f4\u65b0\u3002',
            tag: 'Field Ops',
            exact: true,
          },
          {
            to: '/attendance',
            label: '\u51fa\u52e4\u4e2d\u5fc3',
            desc: '\u5f59\u6574\u4eba\u54e1\u51fa\u52e4\u3001\u5de5\u6642\u8207\u7570\u5e38\u7d00\u9304\u3002',
            tag: 'Field Ops',
            exact: true,
          },
          {
            to: '/calendar',
            label: '\u884c\u4e8b\u66c6',
            desc: '\u7528\u65e5\u66c6\u65b9\u5f0f\u67e5\u770b\u6392\u7a0b\u8207\u4efb\u52d9\u6642\u9593\u3002',
            tag: 'Schedule',
            exact: true,
          },
        ],
      },
      {
        id: 'crm',
        label: 'CRM / \u696d\u52d9',
        hint: '\u5ba2\u6236\u8207\u5831\u50f9',
        items: [
          {
            to: '/crm',
            label: '\u7d93\u71df\u7ba1\u7406\u9996\u9801',
            desc: '\u7d71\u6574 CRM \u6a21\u7d44\u6578\u64da\u8207\u6700\u8fd1\u696d\u52d9\u52d5\u614b\u3002',
            tag: 'Dashboard',
            exact: true,
          },
          {
            to: '/crm/customers',
            label: '\u5ba2\u6236\u7ba1\u7406',
            desc: '\u7dad\u8b77\u5ba2\u6236\u4e3b\u6a94\u8207\u57fa\u672c\u806f\u7d61\u8cc7\u8a0a\u3002',
            tag: 'Master Data',
            exact: true,
          },
          {
            to: '/crm/contacts',
            label: '\u806f\u7d61\u4eba\u7ba1\u7406',
            desc: '\u7ba1\u7406\u5ba2\u6236\u806f\u7d61\u7a97\u53e3\u8207\u806f\u7e6b\u65b9\u5f0f\u3002',
            tag: 'Master Data',
            exact: true,
          },
          {
            to: '/crm/quotes',
            label: '\u5831\u50f9\u55ae',
            desc: '\u5efa\u7acb\u5831\u50f9\u3001\u8f49\u8acb\u6b3e\u55ae\u4e26\u4e0b\u8f09 PDF\u3002',
            tag: 'Sales',
            exact: true,
          },
          {
            to: '/crm/catalog',
            label: '\u50f9\u76ee\u8cc7\u6599\u5eab',
            desc: '\u7dad\u8b77\u5e38\u7528\u670d\u52d9\u54c1\u9805\u3001\u55ae\u4f4d\u8207\u9810\u8a2d\u50f9\u683c\u3002',
            tag: 'Pricing',
            exact: true,
          },
          {
            to: '/crm/bookings',
            label: '\u7db2\u7ad9\u9810\u7d04',
            desc: '\u6aa2\u8996\u5b98\u7db2\u9810\u7d04\u8cc7\u6599\u4e26\u8f49\u6210\u5ba2\u6236\u8207\u806f\u7d61\u4eba\u3002',
            tag: 'Leads',
            exact: true,
          },
        ],
      },
      {
        id: 'reports',
        label: '\u5831\u8868 / \u5eab\u5b58',
        hint: '\u5206\u6790\u8207\u6750\u6599',
        items: [
          {
            to: '/reports',
            label: '\u5831\u8868\u4e2d\u5fc3',
            desc: '\u6aa2\u8996\u71df\u904b\u6578\u64da\u8207\u4efb\u52d9\u7d71\u8a08\u5831\u8868\u3002',
            tag: 'Analytics',
            exact: true,
          },
          {
            to: '/materials/purchases',
            label: '\u6750\u6599\u63a1\u8cfc',
            desc: '\u5efa\u7acb\u8017\u6750\u4e3b\u6a94\u3001\u8a18\u9304\u9032\u8ca8\u8207\u5165\u5eab\u6210\u672c\u3002',
            tag: 'Materials',
            managerOnly: true,
            exact: true,
          },
          {
            to: '/materials/reports',
            label: '\u8017\u6750\u6708\u7d50\u5831\u8868',
            desc: '\u67e5\u770b\u6bcf\u6708\u9032\u8ca8\u3001\u8017\u7528\u3001\u5eab\u5b58\u8207\u7570\u52d5\u5e33\u3002',
            tag: 'Materials',
            managerOnly: true,
            exact: true,
          },
        ],
      },
      {
        id: 'system',
        label: '\u7cfb\u7d71\u8a2d\u5b9a',
        hint: '\u5e33\u865f\u8207\u7ba1\u7406',
        items: [
          {
            to: '/profile',
            label: '\u500b\u4eba\u8a2d\u5b9a',
            desc: '\u8abf\u6574\u5e33\u865f\u8cc7\u8a0a\u3001\u901a\u77e5\u8207\u767b\u5165\u8a2d\u5b9a\u3002',
            tag: 'Account',
            exact: true,
          },
          {
            to: '/admin',
            label: '\u7ba1\u7406\u5f8c\u53f0',
            desc: '\u7ba1\u7406\u5e33\u865f\u3001\u6b0a\u9650\u8207\u7cfb\u7d71\u5c64\u7d1a\u8a2d\u5b9a\u3002',
            tag: 'Admin',
            adminOnly: true,
            exact: true,
          },
        ],
      },
    ],
    [],
  );

  const visibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false;
            if (item.managerOnly && user?.role === 'worker') return false;
            return true;
          }),
        }))
        .filter((group) => group.items.length > 0),
    [isAdmin, navGroups, user?.role],
  );

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
                          <span className="app-sidebar__sublink-content">
                            {item.tag ? <span className="app-sidebar__sublink-tag">{item.tag}</span> : null}
                            <strong>{item.label}</strong>
                            {item.desc ? <small>{item.desc}</small> : null}
                          </span>
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
