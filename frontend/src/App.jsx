import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react'; // 引入狀態管理
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function App() {
  // 1. 使用 useState，這樣狀態改變時 React 才會重新渲染
  const [token, setToken] = useState(localStorage.getItem('token'));

  // 2. 建立一個更新 Token 的函式，傳給 Login 組件使用
  const updateAuth = () => {
    setToken(localStorage.getItem('token'));
  };

  const isAuthenticated = !!token;

  return (
    <Router>
      <Routes>
        {/* 將更新函式傳給 Login，登入成功時呼叫它 */}
        <Route path="/login" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <Login onLoginSuccess={updateAuth} />
        } />
        
        <Route 
          path="/dashboard" 
          element={isAuthenticated ? <Dashboard onLogout={updateAuth} /> : <Navigate to="/login" />} 
        />

        <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  );
}

export default App;