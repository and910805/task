import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import brandFallback from '../assets/brand-logo.svg';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';

const LoginPixelShowcase = ({ brandName }) => (
  <section className="login-showcase" aria-hidden="true">
    <div className="login-showcase__panel">
      <div className="login-showcase__label">現場派工工作台</div>
      <div className="login-showcase__screen">
        <div className="login-showcase__grid" />
        <div className="login-showcase__scanline" />
        <div className="login-showcase__shadow" />
        <aside className="login-dino-loader" style={{ '--wh-number': 24 }} aria-hidden="true">
          <div className="login-dino-loader__pixel" />
        </aside>
      </div>
      <div className="login-showcase__copy">
        <h2>{brandName}</h2>
        <p>任務、工時、行事曆、LINE 通知整合</p>
        <div className="login-showcase__chips">
          <span>派工</span>
          <span>工時</span>
          <span>行事曆</span>
          <span>報價</span>
        </div>
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
  const brandName = branding.name || '立翔水電行';
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
      } else {
        await register({
          username: form.username,
          password: form.password,
        });
        toast.success('帳號建立成功，請使用該帳號登入。');
        setForm({ username: '', password: '' });
        setMode('login');
      }
    } catch (err) {
      const isLogin = mode === 'login';
      const notFoundUser = err.response?.status === 404 && isLogin;
      const message =
        (notFoundUser && '沒有這個使用者') ||
        err.response?.data?.msg ||
        '操作失敗，請稍後再試。';

      toast.error(message);
    }
  };

  const switchMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <LoginPixelShowcase brandName={brandName} />
        <form className="login-card login-card--animated" onSubmit={handleSubmit}>
          <div className="card-header">
            <div className="login-brand">
              <div className="login-brand__logo">
                <img src={logoSrc} alt={`${brandName} Logo`} />
              </div>
              <h1 className="login-brand__name">{brandName}</h1>
            </div>
            <p className="login-card__subtitle">
              {mode === 'login' ? '請輸入帳號密碼登入系統' : '建立新的工人帳號'}
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
            {mode === 'login' ? '登入' : '註冊'}
          </button>
          <p className="login-switch">
            {mode === 'login' ? '沒有帳號？' : '已有帳號？'}{' '}
            <button type="button" onClick={switchMode}>
              {mode === 'login' ? '建立新帳號' : '立即登入'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
