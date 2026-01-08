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
    return <Navigate to="/" replace />;
  }
  return children;
};

const AppRoutes = () => (
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
