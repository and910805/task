import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from 'react-hot-toast';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { BrandingProvider } from './context/BrandingContext.jsx';
import { RoleLabelProvider } from './context/RoleLabelContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './App.css';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage.jsx'));
const TaskListPage = lazy(() => import('./pages/TaskListPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const TaskCalendarPage = lazy(() => import('./pages/TaskCalendarPage.jsx'));
const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'));
const StatsPage = lazy(() => import('./pages/StatsPage.jsx'));

const PrivateRoute = ({ children, roles }) => {
  const { isAuthenticated, user, initializing } = useAuth();

  if (initializing) {
    return <div className="page-loading">登入狀態確認中...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

const AppRoutes = () => (
  <Suspense fallback={<div className="page-loading">Loading...</div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
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
        path="/overview"
        element={(
          <PrivateRoute roles={["admin", "hq_staff", "site_supervisor"]}>
            <OverviewPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/stats"
        element={(
          <PrivateRoute roles={["admin", "hq_staff", "site_supervisor"]}>
            <StatsPage />
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
  </Suspense>
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
