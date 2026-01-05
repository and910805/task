import { useEffect, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const ProfilePage = () => {
  const { user, refreshUser } = useAuth();
  const { labels } = useRoleLabels();
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notificationForm, setNotificationForm] = useState({
    notification_type: user?.notification_type || 'none',
    notification_value:
      user?.notification_type === 'email' ? user?.notification_value || '' : '',
  });
  const [notificationError, setNotificationError] = useState('');
  const [notificationSuccess, setNotificationSuccess] = useState('');
  const [notificationSubmitting, setNotificationSubmitting] = useState(false);
  const [emailTestSubmitting, setEmailTestSubmitting] = useState(false);
  const [emailTestMessage, setEmailTestMessage] = useState('');

  const [lineBindInfo, setLineBindInfo] = useState(null);
  const [lineBindBusy, setLineBindBusy] = useState(false);
  const [lineTestBusy, setLineTestBusy] = useState(false);
  const [lineMessage, setLineMessage] = useState('');

  useEffect(() => {
    setNotificationForm({
      notification_type: user?.notification_type || 'none',
      notification_value:
        user?.notification_type === 'email' ? user?.notification_value || '' : '',
    });
  }, [user]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (form.new_password !== form.confirm_password) {
      setError('新密碼與確認密碼不一致');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('auth/change-password', form);
      setSuccess('密碼已更新，請使用新密碼登入。');
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      await refreshUser();
    } catch (err) {
      const message = err.response?.data?.msg || '修改密碼失敗。';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotificationTypeChange = (event) => {
    const { value } = event.target;
    setNotificationForm((prev) => ({
      notification_type: value,
      notification_value: value === 'email' ? prev.notification_value : '',
    }));
  };

  const handleNotificationValueChange = (event) => {
    const { value } = event.target;
    setNotificationForm((prev) => ({ ...prev, notification_value: value }));
  };

  const handleNotificationSubmit = async (event) => {
    event.preventDefault();
    setNotificationError('');
    setNotificationSuccess('');
    setNotificationSubmitting(true);
    try {
      await api.put('auth/notification-settings', {
        notification_type: notificationForm.notification_type,
        notification_value: notificationForm.notification_value,
      });
      setNotificationSuccess('通知設定已更新。');
      await refreshUser();
    } catch (err) {
      const message = err.response?.data?.msg || '更新通知設定失敗。';
      setNotificationError(message);
    } finally {
      setNotificationSubmitting(false);
    }
  };


  const handleSendTestEmail = async () => {
    setEmailTestMessage('');
    setEmailTestSubmitting(true);
    try {
      await api.post('auth/test-email');
      setEmailTestMessage('已送出測試信，請至信箱（含垃圾郵件）確認。');
    } catch (err) {
      const msg = err?.response?.data?.msg || '寄送測試信失敗，請稍後再試。';
      setEmailTestMessage(msg);
    } finally {
      setEmailTestSubmitting(false);
    }
  };


  const handleCreateLineBindCode = async () => {
    setLineMessage('');
    setLineBindInfo(null);
    setLineBindBusy(true);
    try {
      const { data } = await api.post('auth/line/bind-code');
      setLineBindInfo({ code: data?.code, expires_at: data?.expires_at });
      setLineMessage('已產生綁定碼，請到 LINE Bot 貼上 bind <綁定碼>');
    } catch (err) {
      const msg = err?.response?.data?.msg || '產生綁定碼失敗。';
      setLineMessage(msg);
    } finally {
      setLineBindBusy(false);
    }
  };

  const handleTestLine = async () => {
    setLineMessage('');
    setLineTestBusy(true);
    try {
      await api.post('auth/test-line');
      setLineMessage('已送出 LINE 測試通知。');
    } catch (err) {
      const msg = err?.response?.data?.msg || '送出 LINE 測試通知失敗。';
      setLineMessage(msg);
    } finally {
      setLineTestBusy(false);
    }
  };

  const handleUnbindLine = async () => {
    setLineMessage('');
    setLineTestBusy(true);
    try {
      await api.post('auth/line/unbind');
      setLineMessage('已解除 LINE 綁定。');
      await refreshUser();
    } catch (err) {
      const msg = err?.response?.data?.msg || '解除綁定失敗。';
      setLineMessage(msg);
    } finally {
      setLineTestBusy(false);
    }
  };

  return (
    <div className="page">
      <AppHeader title="個人資料" subtitle="查看帳號資訊並更新登入密碼" />
      <section className="panel">
        <h2>帳號資訊</h2>
        <p>
          帳號：<strong>{user?.username}</strong>
        </p>
        <p>
          角色：
          <strong>{labels[user?.role] || user?.role}</strong>
        </p>
      </section>
      <section className="panel">
        <h2>修改密碼</h2>
        {error && <p className="error-text">{error}</p>}
        {success && <p className="success-text">{success}</p>}
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            舊密碼
            <input
              type="password"
              name="current_password"
              value={form.current_password}
              onChange={handleChange}
              placeholder="輸入目前使用的密碼"
              required
            />
          </label>
          <label>
            新密碼
            <input
              type="password"
              name="new_password"
              value={form.new_password}
              onChange={handleChange}
              placeholder="輸入新的密碼"
              required
            />
          </label>
          <label>
            確認新密碼
            <input
              type="password"
              name="confirm_password"
              value={form.confirm_password}
              onChange={handleChange}
              placeholder="再次輸入新的密碼"
              required
            />
          </label>
          <button type="submit" disabled={submitting}>
            儲存變更
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>通知設定</h2>
        <p className="panel-hint">任務指派、狀態更新與完成時的提醒方式。</p>
        {notificationError && <p className="error-text">{notificationError}</p>}
        {notificationSuccess && <p className="success-text">{notificationSuccess}</p>}
        <form className="stack" onSubmit={handleNotificationSubmit}>
          <label>
            通知方式
            <select
              name="notification_type"
              value={notificationForm.notification_type}
              onChange={handleNotificationTypeChange}
            >
              <option value="none">不接收通知</option>
              <option value="email">Email</option>
              <option value="line">LINE</option>
            </select>
          </label>
          {notificationForm.notification_type === 'email' ? (
            <label>
              Email
              <input
                type="email"
                name="notification_value"
                value={notificationForm.notification_value}
                onChange={handleNotificationValueChange}
                placeholder="example@mail.com"
                required
              />
            </label>
          ) : null}
          {notificationForm.notification_type === 'line' ? (
            <div className="stack">
              <p className="hint-text">
                使用 LINE Bot 通知：請先加入 Bot 好友，並在這裡產生綁定碼。
              </p>

              <div className="row">
                <button type="button" onClick={handleCreateLineBindCode} disabled={lineBindBusy}>
                  {lineBindBusy ? '產生中…' : '產生綁定碼'}
                </button>
                <button
                  type="button"
                  onClick={handleTestLine}
                  disabled={lineTestBusy || !(user?.notification_type === 'line' && user?.notification_hint)}
                >
                  {lineTestBusy ? '送出中…' : 'LINE 測試通知'}
                </button>
                <button
                  type="button"
                  onClick={handleUnbindLine}
                  disabled={lineTestBusy || !(user?.notification_type === 'line' && user?.notification_hint)}
                >
                  解除綁定
                </button>
              </div>

              {lineBindInfo?.code ? (
                <div className="panel-sub">
                  <p>綁定碼：<strong>{lineBindInfo.code}</strong></p>
                  {lineBindInfo.expires_at ? <p className="hint-text">有效期限：{lineBindInfo.expires_at}</p> : null}
                  <p className="hint-text">到 LINE 對 Bot 傳：<strong>bind {lineBindInfo.code}</strong></p>
                </div>
              ) : null}

              {user?.notification_type === 'line' && user.notification_hint ? (
                <p className="hint-text">目前已綁定：{user.notification_hint}</p>
              ) : (
                <p className="hint-text">尚未綁定（綁定後才會收到 LINE 通知）</p>
              )}

              {lineMessage ? <p className="hint-text">{lineMessage}</p> : null}
            </div>
          ) : null}
          <button type="submit" disabled={notificationSubmitting}>
            {notificationSubmitting ? '儲存中…' : '儲存通知設定'}
          </button>
          {notificationForm.notification_type === 'email' ? (
            <>
              <button
                type="button"
                onClick={handleSendTestEmail}
                disabled={emailTestSubmitting || !notificationForm.notification_value}
              >
                {emailTestSubmitting ? '寄送中…' : '寄送測試信'}
              </button>
              {emailTestMessage ? <p className="hint-text">{emailTestMessage}</p> : null}
            </>
          ) : null}
        </form>
      </section>
    </div>
  );
};

export default ProfilePage;
