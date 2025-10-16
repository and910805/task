import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loading } = useAuth();
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '' });
  const [success, setSuccess] = useState('');

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      if (mode === 'login') {
        await login({ username: form.username, password: form.password });
        navigate('/');
      } else {
        await register({ username: form.username, password: form.password });
        setSuccess('帳號建立成功，請使用該帳號登入。');
        setForm({ username: '', password: '' });
        setMode('login');
      }
    } catch (err) {
      const message = err.response?.data?.msg || '操作失敗，請稍後再試。';
      setError(message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-brand">
        <h1>立翔水電行</h1>
      </div>
      <form className="auth-card" onSubmit={handleSubmit}>
        <h2>{mode === 'login' ? '登入' : '建立帳號'}</h2>
        {error && <p className="error-text">{error}</p>}
        {success && <p className="success-text">{success}</p>}
        <label>
          帳號
          <input
            type="text"
            name="username"
            value={form.username}
            onChange={handleChange}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {mode === 'login' ? '登入' : '註冊'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setSuccess('');
          }}
        >
          {mode === 'login' ? '沒有帳號？建立新帳號' : '已有帳號？立即登入'}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
