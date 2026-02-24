import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import brandFallback from '../assets/brand-logo.svg';
import LoginPixelDino from '../components/LoginPixelDino.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';

const LoginPixelShowcase = () => (
  <section className="login-showcase" aria-hidden="true">
    <div className="login-showcase__panel">
      <div className="login-showcase__label">現場派工工作台</div>
      <div className="login-showcase__screen">
        <div className="login-showcase__grid" />
        <div className="login-showcase__scanline" />
        <div className="login-showcase__shadow" />
        <LoginPixelDino />
      </div>
      <div className="login-showcase__copy">
        <h2>派工、工時、行事曆整合</h2>
        <p>現場回報與後台排程同步，支援 LINE 通知與任務追蹤。</p>
        <ul className="login-showcase__features">
          <li>任務指派與接單狀態同步</li>
          <li>工時開始與結束快速記錄</li>
          <li>月曆與週檢視安排行程</li>
          <li>LINE 卡片通知與快捷操作</li>
        </ul>
      </div>
    </div>
  </section>
);

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loading } = useAuth();
  const { branding, refresh: refreshBranding } = useBranding();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });

  const brandName = branding.name || '立翔水電工程行';
  const logoSrc = branding.logoUrl || brandFallback;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      if (mode === 'login') {
        await login({ username: form.username, password: form.password });
        refreshBranding().catch(() => {});
        navigate('/app');
        return;
      }

      await register({
        username: form.username,
        password: form.password,
      });
      toast.success('建立帳號成功，請使用新帳號登入');
      setForm({ username: '', password: '' });
      setMode('login');
    } catch (err) {
      const isLogin = mode === 'login';
      const notFoundUser = err.response?.status === 404 && isLogin;
      const message =
        (notFoundUser && '查無此帳號或密碼錯誤') ||
        err.response?.data?.msg ||
        '操作失敗，請稍後再試';

      toast.error(message);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <LoginPixelShowcase />
        <form className="login-card login-card--animated" onSubmit={handleSubmit}>
          <div className="card-header">
            <div className="login-brand">
              <div className="login-brand__logo">
                <img src={logoSrc} alt={`${brandName} Logo`} />
              </div>
              <div className="login-brand__text">
                <h1 className="login-brand__name">{brandName}</h1>
                <p className="login-brand__tag">OPERATIONS SUITE</p>
              </div>
            </div>
            <p className="login-card__subtitle">
              {mode === 'login' ? '請輸入帳號密碼登入系統' : '建立新帳號開始使用系統'}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="username">帳號</label>
            <input
              id="username"
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
              required
              placeholder="輸入帳號"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密碼</label>
            <input
              id="password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              placeholder="輸入密碼"
            />
          </div>

          <button type="submit" disabled={loading}>
            {mode === 'login' ? '登入' : '建立帳號'}
          </button>

          <p className="login-switch">
            {mode === 'login' ? '沒有帳號？' : '已有帳號？'}{' '}
            <button type="button" onClick={switchMode}>
              {mode === 'login' ? '建立新帳號' : '返回登入'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
