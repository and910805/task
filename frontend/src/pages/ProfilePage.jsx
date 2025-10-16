import { useState } from 'react';

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
      await api.post('/auth/change-password', form);
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
    </div>
  );
};

export default ProfilePage;
