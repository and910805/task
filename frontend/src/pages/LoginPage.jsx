import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Building2, Eye, EyeOff, KeyRound, LogIn } from 'lucide-react';

import api from '../api/client.js';
import brandFallback from '../assets/brand-logo.svg';
import { SESSION_NOTICE_KEY, useAuth } from '../context/AuthContext.jsx';
import { INDUSTRY_OPTIONS, landingPathFor } from '../constants/workspace.js';

const MODES = {
  login: { title: '登入 TaskGo', submit: '登入', icon: LogIn },
  signup: { title: '建立公司帳號', submit: '建立公司並開始使用', icon: Building2 },
  join: { title: '用邀請碼加入公司', submit: '建立帳號並加入', icon: KeyRound },
};

const modeFromPath = (pathname) => {
  if (pathname.startsWith('/signup')) return 'signup';
  if (pathname.startsWith('/join')) return 'join';
  return 'login';
};

const errorMessage = (err, fallback) => {
  if (err?.networkMessage) return err.networkMessage;
  if (err?.response?.status === 401) return '帳號或密碼錯誤';
  if (err?.response?.status === 429) return '嘗試次數過多，請稍後再試';
  return err?.response?.data?.msg || fallback;
};

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, signup, registerWithInvite, loading, isAuthenticated, user, initializing } = useAuth();
  const mode = modeFromPath(location.pathname);
  const returnPath = mode === 'login' && /^\/tasks\/\d+(?:\?.*)?$/.test(location.state?.from ?? '')
    ? location.state.from
    : null;
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [form, setForm] = useState({
    username: '',
    password: '',
    companyName: '',
    industry: 'plumbing_electrical',
    inviteCode: params.get('code') || '',
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [invitePreview, setInvitePreview] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_NOTICE_KEY);
      if (stored) {
        setNotice(stored);
        sessionStorage.removeItem(SESSION_NOTICE_KEY);
      }
    } catch {
      // optional notice
    }
  }, []);

  // Already signed in (e.g. reopening the app): go straight to work.
  useEffect(() => {
    if (!initializing && isAuthenticated && mode === 'login') {
      navigate(returnPath || landingPathFor(user), { replace: true });
    }
  }, [initializing, isAuthenticated, mode, navigate, returnPath, user]);

  useEffect(() => {
    const code = form.inviteCode.trim();
    if (mode !== 'join' || code.length < 6) {
      setInvitePreview(null);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .get('workspaces/invitations/preview', { params: { code }, skipAuthExpiry: true })
        .then(({ data }) => active && setInvitePreview({ ok: true, ...data }))
        .catch(() => active && setInvitePreview({ ok: false }));
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.inviteCode, mode]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      let session;
      if (mode === 'login') {
        session = await login({ username: form.username.trim(), password: form.password });
      } else if (mode === 'signup') {
        session = await signup({
          username: form.username.trim(),
          password: form.password,
          company_name: form.companyName.trim(),
          industry: form.industry,
          accept_terms: form.acceptTerms,
        });
        toast.success('公司已建立，現在可以邀請成員。');
      } else {
        session = await registerWithInvite({
          username: form.username.trim(),
          password: form.password,
          invite_code: form.inviteCode.trim(),
        });
        toast.success('已加入公司');
      }
      navigate(returnPath || landingPathFor(session), { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, '操作失敗，請稍後再試'));
    }
  };

  const { title, submit, icon: ModeIcon } = MODES[mode];
  const isLogin = mode === 'login';

  return (
    <main className="tg-auth">
      <div className="tg-auth__column">
        <header className="tg-auth__brand">
          <img src={brandFallback} alt="" className="tg-auth__logo" />
          <div>
            <p className="tg-auth__product">TaskGo</p>
            <p className="tg-auth__tagline">現場派工、工時與施工回報</p>
          </div>
        </header>

        <form className="tg-card tg-auth__card" onSubmit={handleSubmit}>
          <h1 className="tg-auth__title">
            <ModeIcon aria-hidden="true" />
            {title}
          </h1>
          {notice ? <p className="tg-notice" role="status">{notice}</p> : null}

          {mode === 'join' ? (
            <div className="tg-field">
              <label htmlFor="inviteCode">邀請碼</label>
              <input
                id="inviteCode"
                name="inviteCode"
                value={form.inviteCode}
                onChange={handleChange}
                autoCapitalize="characters"
                autoComplete="off"
                required
                placeholder="向公司管理員索取"
              />
              {invitePreview?.ok ? (
                <p className="tg-hint tg-hint--ok">
                  將以「{invitePreview.role_label}」加入 {invitePreview.workspace_name}
                </p>
              ) : null}
              {invitePreview && !invitePreview.ok ? (
                <p className="tg-hint tg-hint--error">邀請碼無效或已過期</p>
              ) : null}
            </div>
          ) : null}

          {mode === 'signup' ? (
            <>
              <div className="tg-field">
                <label htmlFor="companyName">公司名稱</label>
                <input
                  id="companyName"
                  name="companyName"
                  value={form.companyName}
                  onChange={handleChange}
                  maxLength={120}
                  required
                  placeholder="例如：大安水電行"
                />
              </div>
              <div className="tg-field">
                <label htmlFor="industry">服務類型</label>
                <select id="industry" name="industry" value={form.industry} onChange={handleChange}>
                  {INDUSTRY_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          <div className="tg-field">
            <label htmlFor="username">帳號</label>
            <input
              id="username"
              name="username"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
              autoCapitalize="none"
              required
              maxLength={80}
            />
          </div>

          <div className="tg-field">
            <label htmlFor="password">密碼</label>
            <div className="tg-password">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={handleChange}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                minLength={isLogin ? undefined : 10}
                required
              />
              <button
                type="button"
                className="tg-icon-button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
            {!isLogin ? <p className="tg-hint">至少 10 個字元</p> : null}
          </div>

          {mode === 'signup' ? (
            <label className="tg-check">
              <input type="checkbox" name="acceptTerms" checked={form.acceptTerms} onChange={handleChange} required />
              <span>
                我同意 <Link to="/legal/terms">服務條款</Link> 與 <Link to="/legal/privacy">隱私權政策</Link>
              </span>
            </label>
          ) : null}

          <button type="submit" className="tg-button tg-button--primary tg-button--block" disabled={loading}>
            {loading ? '處理中…' : submit}
          </button>

          <nav className="tg-auth__switch" aria-label="其他登入方式">
            {mode !== 'login' ? <Link to="/login">已有帳號，直接登入</Link> : null}
            {mode !== 'join' ? <Link to="/join">有邀請碼？加入公司</Link> : null}
            {mode !== 'signup' ? <Link to="/signup">建立新公司</Link> : null}
          </nav>
        </form>

        <footer className="tg-auth__footer">
          <Link to="/legal/privacy">隱私權政策</Link>
          <span aria-hidden="true">·</span>
          <Link to="/legal/terms">服務條款</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/legal/support">聯絡客服</Link>
        </footer>
      </div>
    </main>
  );
};

export default LoginPage;
