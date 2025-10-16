import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';

const roles = [
  { value: 'worker', label: '工人' },
  { value: 'site_supervisor', label: '現場主管' },
  { value: 'hq_staff', label: '總部人員' },
  { value: 'admin', label: '管理員' },
];

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loading } = useAuth();
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', role: 'worker' });
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
        await register(form);
        setSuccess('帳號建立成功，請使用該帳號登入。');
        setForm({ username: '', password: '', role: 'worker' });
        setMode('login');
      }
    } catch (err) {
      const message = err.response?.data?.msg || '操作失敗，請稍後再試。';
      setError(message);
    }
  };

  return (
    <div className="auth-container">
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
        {mode === 'register' && (
          <label>
            角色
            <select name="role" value={form.role} onChange={handleChange}>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
