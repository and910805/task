import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import TaskDetailPage from './pages/TaskDetailPage.jsx';
import TaskListPage from './pages/TaskListPage.jsx';
import './App.css';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
