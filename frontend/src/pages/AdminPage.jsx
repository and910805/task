import { useEffect, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { roleLabels, roleOptions } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const AdminPage = () => {
  const { user, token, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [userCount, setUserCount] = useState(0);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    role: 'worker',
  });

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/auth/users');
      const list = Array.isArray(data) ? data : data?.users ?? [];
      const total = Array.isArray(data) ? data.length : data?.total;
      setUsers(list);
      setUserCount(typeof total === 'number' ? total : list.length);
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) {
        logout();
        setError('登入資訊已失效，請重新登入。');
      } else {
        const message = err.response?.data?.msg || '無法取得使用者列表。';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleExport = async () => {
    setExportError('');
    setExportSuccess('');
    setExporting(true);
    try {
      const { data } = await api.get('/export/tasks');
      const downloadUrl = data?.url;
      if (downloadUrl) {
        const resolvedUrl = /^https?:\/\//i.test(downloadUrl)
          ? downloadUrl
          : token
            ? `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
            : downloadUrl;
        window.open(resolvedUrl, '_blank', 'noopener');
        setExportSuccess('報表匯出完成，已在新分頁開啟下載。');
      } else {
        setExportSuccess('報表已產生。');
      }
    } catch (err) {
      const message = err.response?.data?.msg || '匯出報表失敗。';
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!form.username.trim() || !form.password.trim()) {
      setFormError('請輸入帳號與密碼');
      return;
    }

    try {
      const payload = {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
      };
      await api.post('/auth/register', payload);
      setFormSuccess('帳號建立成功。');
      setForm({ name: '', username: '', password: '', role: 'worker' });
      await loadUsers();
    } catch (err) {
      const message = err.response?.data?.msg || '建立帳號失敗。';
      setFormError(message);
    }
  };

  const handleDelete = async (targetUser) => {
    if (targetUser.id === user?.id) {
      setError('無法刪除目前登入的帳號。');
      return;
    }
    const confirmed = window.confirm(`確定要刪除 ${targetUser.username} 嗎？`);
    if (!confirmed) return;

    try {
      await api.delete(`/auth/users/${targetUser.id}`);
      await loadUsers();
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) {
        logout();
        setError('登入資訊已失效，請重新登入。');
      } else {
        const message = err.response?.data?.msg || '刪除帳號失敗。';
        setError(message);
      }
    }
  };

  const assignedTasksText = (tasks) => {
    if (!tasks || tasks.length === 0) return '無';
    return tasks
      .map((task) => `${task.title}（${task.status}）`)
      .join('、');
  };

  return (
    <div className="page">
      <AppHeader title="使用者管理" subtitle="建立、檢視與移除系統帳號" />
      <section className="panel">
        <h2>匯出報表</h2>
        <p className="panel-hint">產出任務、附件與工時的 Excel 報表。</p>
        {exportError && <p className="error-text">{exportError}</p>}
        {exportSuccess && <p className="success-text">{exportSuccess}</p>}
        <button type="button" onClick={handleExport} disabled={exporting}>
          {exporting ? '匯出中…' : '匯出任務報表'}
        </button>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>新增帳號</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setForm((prev) => ({ ...prev, role: 'worker' }))}
          >
            新增工人
          </button>
        </div>
        <p className="panel-hint">快速建立工人帳號時預設角色為工人，其餘角色請自行選擇。</p>
        {formError && <p className="error-text">{formError}</p>}
        {formSuccess && <p className="success-text">{formSuccess}</p>}
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            名稱（選填）
            <input
              name="name"
              value={form.name}
              onChange={handleFormChange}
              placeholder="可輸入人員顯示名稱"
            />
          </label>
          <label>
            帳號
            <input
              name="username"
              value={form.username}
              onChange={handleFormChange}
              placeholder="登入帳號"
              required
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleFormChange}
              placeholder="設定登入密碼"
              required
            />
          </label>
          <label>
            角色
            <select name="role" value={form.role} onChange={handleFormChange}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">建立帳號</button>
        </form>
      </section>
      <section className="panel">
        <h2>使用者清單（{userCount}）</h2>
        {error && <p className="error-text">{error}</p>}
        {loading ? (
          <p>載入中...</p>
        ) : users.length === 0 ? (
          <p>目前沒有其他使用者。</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>帳號</th>
                  <th>角色</th>
                  <th>指派任務</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.username}</td>
                    <td>{roleLabels[item.role] || item.role}</td>
                    <td>{assignedTasksText(item.assigned_tasks)}</td>
                    <td>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => handleDelete(item)}
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminPage;
