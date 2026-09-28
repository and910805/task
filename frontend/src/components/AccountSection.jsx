import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isNativeApp, pushPermissionState, requestPushPermission } from '../native/push.js';

const errorText = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

const PUSH_LABELS = {
  granted: '已開啟',
  denied: '已關閉（請到 iOS 設定 → TaskGo → 通知 開啟）',
  prompt: '尚未設定',
  'prompt-with-rationale': '尚未設定',
};

// Push status, leaving a company and self-service account deletion.
const AccountSection = () => {
  const { user, activeWorkspace, refreshUser, clearSession } = useAuth();
  const [pushState, setPushState] = useState(null);
  const [serverPush, setServerPush] = useState(null);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    pushPermissionState().then(setPushState).catch(() => setPushState(null));
    api.get('workspaces/push-status', { skipWorkspace: true })
      .then(({ data }) => setServerPush(Boolean(data?.configured)))
      .catch(() => setServerPush(false));
  }, []);

  const enablePush = async () => {
    const state = await requestPushPermission().catch(() => 'denied');
    setPushState(state);
  };

  const leave = async () => {
    if (!window.confirm(`確定離開「${activeWorkspace?.name}」？你將無法再看到這間公司的工作。`)) return;
    setBusy(true);
    try {
      await api.post('workspaces/current/leave');
      toast.success('已離開公司');
      localStorage.removeItem('active_workspace_id');
      await refreshUser();
      window.location.assign('/today');
    } catch (err) {
      toast.error(errorText(err, '離開失敗'));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.delete('auth/account', { data: { password }, skipAuthExpiry: true });
      clearSession('帳號已刪除。');
      window.location.assign('/login');
    } catch (err) {
      toast.error(errorText(err, '刪除帳號失敗'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>帳號與公司</h2>
      <p className="panel-hint">
        目前帳號：{user?.username}
        {activeWorkspace ? `，目前公司：${activeWorkspace.name}（${activeWorkspace.role_label}）` : ''}
      </p>

      {isNativeApp() ? (
        <div className="tg-section">
          <h3>派工通知</h3>
          {serverPush === false ? (
            <p className="hint-text">推播通知尚未在伺服器端啟用，目前請使用 Email 或 LINE 通知。</p>
          ) : (
            <p className="hint-text">狀態：{PUSH_LABELS[pushState] || '檢查中…'}</p>
          )}
          {serverPush && pushState && pushState.startsWith('prompt') ? (
            <button type="button" onClick={enablePush}>開啟派工通知</button>
          ) : null}
        </div>
      ) : null}

      <div className="tg-row" style={{ marginBottom: '1rem' }}>
        <Link to="/onboarding" className="tg-button tg-button--sm">加入或建立公司</Link>
        {activeWorkspace && !activeWorkspace.is_owner ? (
          <button type="button" className="tg-button tg-button--sm" onClick={leave} disabled={busy}>離開這間公司</button>
        ) : null}
        <Link to="/legal/privacy" className="tg-button tg-button--sm tg-button--ghost">隱私權政策</Link>
        <Link to="/legal/support" className="tg-button tg-button--sm tg-button--ghost">聯絡客服</Link>
      </div>

      <h3>刪除帳號</h3>
      <p className="hint-text">
        刪除後無法復原。你是擁有者且公司還有其他成員時，需先到「成員與邀請」轉移擁有權；
        只有你一人的公司會連同工作資料一起刪除。
      </p>
      {confirming ? (
        <form onSubmit={deleteAccount} className="stack">
          <label>
            輸入密碼確認
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <div className="tg-row">
            <button type="submit" className="tg-button tg-button--danger" disabled={busy || !password}>永久刪除帳號</button>
            <button type="button" className="tg-button tg-button--ghost" onClick={() => setConfirming(false)}>取消</button>
          </div>
        </form>
      ) : (
        <button type="button" className="tg-button tg-button--danger" onClick={() => setConfirming(true)}>刪除帳號…</button>
      )}
    </section>
  );
};

export default AccountSection;
