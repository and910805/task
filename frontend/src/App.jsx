import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from 'react-hot-toast';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { BrandingProvider } from './context/BrandingContext.jsx';
import { RoleLabelProvider } from './context/RoleLabelContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
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
import './App.css';

const managerOnlyRouteRoles = ['site_supervisor', 'hq_staff', 'admin'];

const PrivateRoute = ({ children, roles }) => {
  const { isAuthenticated, user, initializing } = useAuth();

  if (initializing) {
    return <div className="page-loading">登入狀態確認中...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user?.role)) {
    return <Navigate to="/app" replace />;
  }
  return children;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
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
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <CrmDashboardPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/customers"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <CrmCustomersPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/contacts"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <CrmContactsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/quotes"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <CrmQuotesPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/catalog"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <CrmCatalogPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/bookings"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
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
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <ReportsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/materials/purchases"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
          <MaterialsPurchasesPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/materials/reports"
      element={(
        <PrivateRoute roles={managerOnlyRouteRoles}>
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
              <AppRoutes />
            </BrowserRouter>
            <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
          </RoleLabelProvider>
        </AuthProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}

export default App;
