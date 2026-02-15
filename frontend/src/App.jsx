import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from 'react-hot-toast';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { BrandingProvider } from './context/BrandingContext.jsx';
import { RoleLabelProvider } from './context/RoleLabelContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
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
import AttendancePage from './pages/AttendancePage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import './App.css';

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
    <Route path="/" element={<LandingPage />} />
    <Route path="/sale" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route
      path="/app"
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
        <PrivateRoute>
          <CrmDashboardPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/customers"
      element={(
        <PrivateRoute>
          <CrmCustomersPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/contacts"
      element={(
        <PrivateRoute>
          <CrmContactsPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/quotes"
      element={(
        <PrivateRoute>
          <CrmQuotesPage />
        </PrivateRoute>
      )}
    />
    <Route
      path="/crm/catalog"
      element={(
        <PrivateRoute>
          <CrmCatalogPage />
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
        <PrivateRoute>
          <ReportsPage />
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
    <Route path="*" element={<Navigate to="/" replace />} />
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
