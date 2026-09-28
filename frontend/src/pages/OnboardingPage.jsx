import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Building2, KeyRound } from 'lucide-react';

import brandFallback from '../assets/brand-logo.svg';
import { useAuth } from '../context/AuthContext.jsx';
import { INDUSTRY_OPTIONS, landingPathFor } from '../constants/workspace.js';

const errorText = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

// Reached after signing in without any company, or from the switcher.
const OnboardingPage = () => {
  const navigate = useNavigate();
  const { user, workspaces, createWorkspace, joinWorkspace, logout } = useAuth();
  const [company, setCompany] = useState({ name: '', industry: 'plumbing_electrical' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');

  const create = async (event) => {
    event.preventDefault();
    setBusy('create');
    try {
      const session = await createWorkspace({ name: company.name.trim(), industry: company.industry });
      toast.success('公司已建立');
      navigate(landingPathFor(session), { replace: true });
    } catch (err) {
      toast.error(errorText(err, '建立公司失敗'));
    } finally {
      setBusy('');
    }
  };

  const join = async (event) => {
    event.preventDefault();
    setBusy('join');
    try {
      const session = await joinWorkspace(code.trim());
      toast.success('已加入公司');
      navigate(landingPathFor(session), { replace: true });
    } catch (err) {
      toast.error(errorText(err, '加入失敗'));
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="tg-auth">
      <div className="tg-auth__column" style={{ maxWidth: 720 }}>
        <header className="tg-auth__brand">
          <img src={brandFallback} alt="" className="tg-auth__logo" />
          <div>
            <p className="tg-auth__product">TaskGo</p>
            <p className="tg-auth__tagline">{user?.username}，{workspaces.length ? '加入或建立另一間公司' : '開始前，請先加入或建立公司'}</p>
          </div>
        </header>

        <div className="tg-choice-grid">
          <form className="tg-card" onSubmit={join}>
            <h1 className="tg-auth__title"><KeyRound aria-hidden="true" />我有邀請碼</h1>
            <p className="tg-hint" style={{ marginBottom: '0.9rem' }}>由公司管理員在「成員與邀請」產生。</p>
            <div className="tg-field">
              <label htmlFor="join-code">邀請碼</label>
              <input
                id="join-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </div>
            <button type="submit" className="tg-button tg-button--primary tg-button--block" disabled={busy !== ''}>
              {busy === 'join' ? '加入中…' : '加入公司'}
            </button>
          </form>

          <form className="tg-card" onSubmit={create}>
            <h1 className="tg-auth__title"><Building2 aria-hidden="true" />建立新公司</h1>
            <p className="tg-hint" style={{ marginBottom: '0.9rem' }}>你會成為這間公司的擁有者，可邀請成員。</p>
            <div className="tg-field">
              <label htmlFor="company-name">公司名稱</label>
              <input
                id="company-name"
                value={company.name}
                onChange={(event) => setCompany((prev) => ({ ...prev, name: event.target.value }))}
                maxLength={120}
                required
              />
            </div>
            <div className="tg-field">
              <label htmlFor="company-industry">服務類型</label>
              <select
                id="company-industry"
                value={company.industry}
                onChange={(event) => setCompany((prev) => ({ ...prev, industry: event.target.value }))}
              >
                {INDUSTRY_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="tg-button tg-button--block" disabled={busy !== ''}>
              {busy === 'create' ? '建立中…' : '建立公司'}
            </button>
          </form>
        </div>

        <nav className="tg-auth__footer">
          {workspaces.length ? <Link to={landingPathFor(user)}>返回目前公司</Link> : null}
          {workspaces.length ? <span aria-hidden="true">·</span> : null}
          <button type="button" className="tg-button tg-button--ghost tg-button--sm" onClick={logout}>登出</button>
        </nav>
      </div>
    </main>
  );
};

export default OnboardingPage;
