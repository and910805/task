import { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { Toaster } from 'react-hot-toast';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { BrandingProvider } from './context/BrandingContext.jsx';
import { RoleLabelProvider } from './context/RoleLabelContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import PwaUpdatePrompt from './components/PwaUpdatePrompt.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OperationsDashboardPage from './pages/OperationsDashboardPage.jsx';
import TaskDetailPage from './pages/TaskDetailPage.jsx';
import TaskListPage from './pages/TaskListPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import TaskCalendarPage from './pages/TaskCalendarPage.jsx';
import CrmDashboardPage from './pages/CrmDashboardPage.jsx';
import CrmCustomersPage from './pages/CrmCustomersPage.jsx';
import CrmContactsPage from './pages/CrmContactsPage.jsx';
import CrmQuotesPage from './pages/CrmQuotesPage.jsx';
import CrmCatalogPage from './pages/CrmCatalogPage.jsx';
import CrmPublicBookingsPage from './pages/CrmPublicBookingsPage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import MaterialsPurchasesPage from './pages/MaterialsPurchasesPage.jsx';
import MaterialsMonthlyReportPage from './pages/MaterialsMonthlyReportPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import TodayPage from './pages/TodayPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import LegalPage from './pages/LegalPage.jsx';
import NativeBridge from './components/NativeBridge.jsx';
import MobileTabBar from './components/MobileTabBar.jsx';
import DispatchPage from './pages/DispatchPage.jsx';
import './App.css';
import './styles/taskgo.css';

const managerOnlyRouteRoles = ['site_supervisor', 'hq_staff', 'admin'];
const WorkspaceResolutionContext = createContext(null);

// Links such as /tasks/12?ws=3 (notifications) switch to that company first.
const WorkspaceFromQuery = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchWorkspace, initializing } = useAuth();
  const [failedKey, setFailedKey] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const requestedValue = new URLSearchParams(location.search).get('ws');
  const requested = Number(requestedValue);
  const key = `${location.pathname}?${requestedValue ?? ''}`;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get('ws');
    if (!value || initializing || !user) return;
    const target = Number(value);
    let active = true;
    const clearParam = () => {
      params.delete('ws');
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
    };
    if (Number.isInteger(target) && target === Number(user.active_workspace_id)) {
      setFailedKey('');
      clearParam();
      return () => { active = false; };
    }
    if (!Number.isInteger(target) || !(user.workspaces ?? []).some((item) => Number(item.id) === target)) {
      setFailedKey(key);
      return () => { active = false; };
    }
    setFailedKey('');
    switchWorkspace(target).then((session) => {
      if (!active) return;
      if (Number(session?.active_workspace_id) === target) clearParam();
      else setFailedKey(key);
    }).catch(() => {
      if (active) setFailedKey(key);
    });
    return () => { active = false; };
  }, [initializing, key, location.pathname, location.search, navigate, retryCount, switchWorkspace, user]);

  return (
    <WorkspaceResolutionContext.Provider value={{
      requestedValue,
      requested,
      key,
      failedKey,
      retry: () => { setFailedKey(''); setRetryCount((count) => count + 1); },
    }}>
      <AppRoutes key={`${user?.id ?? 'guest'}:${user?.active_workspace_id ?? 'none'}:${user?.role ?? ''}`} />
    </WorkspaceResolutionContext.Provider>
  );
};

const PrivateRoute = ({ children, roles, module, requireWorkspace = true }) => {
  const { isAuthenticated, user, initializing, activeWorkspace } = useAuth();
  const workspaceResolution = useContext(WorkspaceResolutionContext);
  const location = useLocation();
  const navigate = useNavigate();

  if (initializing) {
    return <div className="page-loading">登入狀態確認中...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  if (location.pathname.startsWith('/tasks/') && workspaceResolution?.requestedValue) {
    const { requestedValue, requested, key, failedKey } = workspaceResolution;
    if (!Number.isInteger(requested) || Number(requestedValue) !== requested || failedKey === key) {
      return (
        <div className="page-loading" role="alert">
          <p>無法開啟此公司的任務。</p>
          <button type="button" onClick={workspaceResolution.retry}>重試</button>{' '}
          <button type="button" onClick={() => navigate(-1)}>返回</button>
        </div>
      );
    }
    if (Number(user?.active_workspace_id) !== requested) {
      return <div className="page-loading" role="status">正在切換公司並載入任務…</div>;
    }
  }
  if (requireWorkspace && !user?.active_workspace_id) {
    return <Navigate to="/onboarding" replace />;
  }
  if (roles && !roles.includes(user?.role)) {
    return <Navigate to={user?.role === 'worker' ? '/today' : '/app'} replace />;
  }
  // Modules not yet isolated per company are closed on the server as well.
  if (module && !activeWorkspace?.modules?.[module]) {
    return <Navigate to="/app" replace />;
  }
  return children;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<LoginPage />} />
    <Route path="/join" element={<LoginPage />} />
    <Route path="/legal/:doc" element={<LegalPage />} />
    <Route
      path="/onboarding"
      element={(
        <PrivateRoute requireWorkspace={false}>
          <OnboardingPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/today"
      element={(
        <PrivateRoute>
          <TodayPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/dispatch/new"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <DispatchPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/team"
      element={(
        <PrivateRoute roles={["admin"]}>
          <TeamPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/app"
      element={(
        <PrivateRoute>
          <OperationsDashboardPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/tasks"
      element={(
        <PrivateRoute>
          <TaskListPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/tasks/:id"
      element={(
        <PrivateRoute>
          <TaskDetailPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/profile"
      element={(
        <PrivateRoute>
          <ProfilePage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/calendar"
      element={(
        <PrivateRoute>
          <TaskCalendarPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmDashboardPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/customers"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmCustomersPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/contacts"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmContactsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/quotes"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmQuotesPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/catalog"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmCatalogPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/bookings"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="crm">
          <CrmPublicBookingsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/attendance"
      element={(
        <PrivateRoute>
          <AttendancePage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/reports"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="reports">
          <ReportsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/materials/purchases"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="materials">
          <MaterialsPurchasesPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/materials/reports"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles} module="materials">
          <MaterialsMonthlyReportPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/admin"
      element={(
        <PrivateRoute roles={["admin"]}>
          <AdminPage />
        </PrivateRoute>
      )}
    />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
);

function App() {
  return (
    <ThemeProvider>
      <BrandingProvider>
        <AuthProvider>
          <RoleLabelProvider>
            <BrowserRouter>
              <WorkspaceFromQuery />
              <NativeBridge />
              <MobileTabBar />
            </BrowserRouter>
            <PwaUpdatePrompt />
            <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
          </RoleLabelProvider>
        </AuthProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}

export default App;
