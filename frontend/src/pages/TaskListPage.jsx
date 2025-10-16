import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles, roleLabels } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const TaskListPage = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', assigned_to_id: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const isManager = managerRoles.has(user?.role);

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

  return (
    <div className="page">
      <AppHeader title="任務管理面板" subtitle="檢視與指派任務" />
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
