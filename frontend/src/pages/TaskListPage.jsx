import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const managerRoles = new Set(['site_supervisor', 'hq_staff', 'admin']);
const roleLabels = {
  worker: '工人',
  site_supervisor: '現場主管',
  hq_staff: '總部人員',
  admin: '管理員',
};

const TaskListPage = () => {
  const { user, logout } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', assigned_to_id: '' });
  const [userForm, setUserForm] = useState({ username: '', role: 'site_supervisor' });
  const [error, setError] = useState('');
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const isManager = useMemo(() => managerRoles.has(user?.role), [user?.role]);
  const isAdmin = user?.role === 'admin';

  const loadTasks = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/tasks');
      setTasks(data);
    } catch (err) {
      const message = err.response?.data?.msg || '無法取得任務列表。';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!isManager) return;
    try {
      const { data } = await api.get('/auth/assignable-users');
      setUsers(data);
    } catch (err) {
      console.error('無法取得使用者列表', err);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    loadUsers();
  }, [isManager]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleUserFormChange = (event) => {
    const { name, value } = event.target;
    setUserForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        title: form.title,
        description: form.description,
        assigned_to_id: form.assigned_to_id || null,
      };
      await api.post('/tasks', payload);
      setForm({ title: '', description: '', assigned_to_id: '' });
      setCreating(false);
      await loadTasks();
    } catch (err) {
      const message = err.response?.data?.msg || '建立任務失敗。';
      setError(message);
    }
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();
    setUserError('');
    setUserSuccess('');
    try {
      const payload = {
        username: userForm.username,
        role: userForm.role,
      };
      const { data } = await api.post('/auth/register', payload);
      const message = data.generated_password
        ? `已建立帳號，初始密碼：${data.generated_password}`
        : '帳號建立成功。';
      setUserSuccess(message);
      setUserForm({ username: '', role: 'site_supervisor' });
      await loadUsers();
    } catch (err) {
      const message = err.response?.data?.msg || '建立帳號失敗。';
      setUserError(message);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>任務管理面板</h1>
        <div className="header-actions">
          <span>
            目前登入：{user?.username}（{roleLabels[user?.role] || user?.role}）
          </span>
          <button type="button" onClick={logout}>
            登出
          </button>
        </div>
      </header>
      {isManager && (
        <section className="panel">
          <button type="button" onClick={() => setCreating((prev) => !prev)}>
            {creating ? '關閉建立表單' : '新增任務'}
          </button>
          {creating && (
            <form className="stack" onSubmit={handleCreate}>
              <label>
                任務名稱
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="輸入任務名稱"
                  required
                />
              </label>
              <label>
                任務描述
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="描述任務內容"
                />
              </label>
              <label>
                指派給
                <select
                  name="assigned_to_id"
                  value={form.assigned_to_id}
                  onChange={handleChange}
                >
                  <option value="">未指派</option>
                  {users.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.username}（{roleLabels[option.role] || option.role}）
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">建立任務</button>
            </form>
          )}
        </section>
      )}
      {isAdmin && (
        <section className="panel">
          <h2>建立主管／總部帳號</h2>
          {userError && <p className="error-text">{userError}</p>}
          {userSuccess && <p className="success-text">{userSuccess}</p>}
          <form className="stack" onSubmit={handleCreateUser}>
            <label>
              帳號名稱
              <input
                name="username"
                value={userForm.username}
                onChange={handleUserFormChange}
                placeholder="輸入帳號名稱"
                required
              />
            </label>
            <label>
              角色
              <select name="role" value={userForm.role} onChange={handleUserFormChange}>
                <option value="site_supervisor">現場主管</option>
                <option value="hq_staff">總部人員</option>
                <option value="admin">管理員</option>
              </select>
            </label>
            <button type="submit">建立帳號</button>
          </form>
        </section>
      )}
      {error && <p className="error-text">{error}</p>}
      <section className="panel">
        <h2>任務列表</h2>
        {loading ? (
          <p>載入中...</p>
        ) : tasks.length === 0 ? (
          <p>目前沒有任務。</p>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.id} className={`task-item status-${task.status}`}>
                <div>
                  <h3>
                    <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                  </h3>
                  <p>{task.description || '沒有描述'}</p>
                  <p>
                    狀態：<strong>{task.status}</strong>
                  </p>
                  <p>指派給：{task.assigned_to || '未指派'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default TaskListPage;
