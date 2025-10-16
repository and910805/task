import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles, roleLabels } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const statusOptions = [
  { value: '尚未接單', label: '尚未接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const initialForm = {
  title: '',
  description: '',
  location: '',
  expected_time: '',
  status: '尚未接單',
  assigned_to_id: '',
};

const statusFilterOptions = [
  { value: 'all', label: '全部任務' },
  ...statusOptions,
];

const TaskListPage = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);

  const isManager = managerRoles.has(user?.role);

  const loadTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get('/tasks');
      setTasks(data);
    } catch (err) {
      const message = err.response?.data?.msg || '無法取得任務列表。';
      setError(message);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
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
    setError('');
    const trimmedTitle = form.title.trim();
    const trimmedDescription = form.description.trim();
    const trimmedLocation = form.location.trim();

    if (!trimmedTitle || !trimmedDescription || !trimmedLocation || !form.expected_time) {
      setError('請完整填寫任務名稱、地點、描述與預計完成時間。');
      return;
    }

    const expectedDate = new Date(form.expected_time);
    if (Number.isNaN(expectedDate.getTime())) {
      setError('預計完成時間格式不正確。');
      return;
    }

    try {
      const payload = {
        title: trimmedTitle,
        description: trimmedDescription,
        location: trimmedLocation,
        expected_time: expectedDate.toISOString(),
        status: form.status,
        assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
      };
      await api.post('/tasks/create', payload);
      setForm(initialForm);
      setCreating(false);
      await loadTasks();
    } catch (err) {
      const message = err.response?.data?.msg || '建立任務失敗。';
      setError(message);
    }
  };

  const handleStatusChange = async (taskId, nextStatus) => {
    setError('');
    try {
      await api.patch(`/tasks/update/${taskId}`, { status: nextStatus });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err.response?.data?.msg || '更新任務狀態失敗。';
      setError(message);
    }
  };

  const handleAssigneeChange = async (taskId, value) => {
    setError('');
    setAssigningTaskId(taskId);
    const nextValue = value === '' ? null : Number(value);
    try {
      await api.patch(`/tasks/update/${taskId}`, { assigned_to_id: nextValue });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err.response?.data?.msg || '更新指派對象失敗。';
      setError(message);
    } finally {
      setAssigningTaskId(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadTasks({ showLoading: false });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteTask = async (taskId, taskTitle) => {
    const confirmed = window.confirm(`確定要刪除「${taskTitle}」任務嗎？`);
    if (!confirmed) {
      return;
    }

    setError('');
    setDeletingTaskId(taskId);
    try {
      await api.delete(`/tasks/${taskId}`);
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err.response?.data?.msg || '刪除任務失敗。';
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') {
      return tasks;
    }
    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const statusBadgeClass = {
    尚未接單: 'status-badge status-pending',
    進行中: 'status-badge status-in-progress',
    已完成: 'status-badge status-completed',
  };

  const headerActions = isManager ? (
    <div className="task-toolbar">
      <label>
        顯示狀態
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          {statusFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  ) : (
    <button
      type="button"
      className="secondary-button"
      onClick={handleRefresh}
      disabled={refreshing}
    >
      {refreshing ? '刷新中…' : '🔄 刷新任務'}
    </button>
  );

  const emptyStateMessage =
    statusFilter === 'all'
      ? '目前沒有任務。'
      : '此狀態沒有符合的任務。';

  return (
    <div className="page">
      <AppHeader
        title="任務管理面板"
        subtitle="檢視與指派任務"
        actions={headerActions}
      />
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
                  required
                />
              </label>
              <label>
                任務地點
                <input
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  placeholder="輸入地點"
                  required
                />
              </label>
              <label>
                預計完成時間
                <input
                  type="datetime-local"
                  name="expected_time"
                  value={form.expected_time}
                  onChange={handleChange}
                  required
                />
              </label>
              <label>
                任務進度
                <select name="status" value={form.status} onChange={handleChange}>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
        ) : filteredTasks.length === 0 ? (
          <p>{emptyStateMessage}</p>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const assigneeMissing =
                task.assigned_to_id &&
                !users.some((option) => option.id === task.assigned_to_id);
              return (
                <li key={task.id} className="task-item">
                  <div>
                    <h3>
                      <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                    </h3>
                    <p>{task.description || '沒有描述'}</p>
                    <p>地點：{task.location}</p>
                    <p>
                      預計完成：
                      {task.expected_time
                        ? new Date(task.expected_time).toLocaleString()
                        : '未設定'}
                    </p>
                    <p>總工時：{(task.total_work_hours ?? 0).toFixed(2)} 小時</p>
                    <p>
                      任務進度：
                      {isManager ? (
                        <span className="task-status-control">
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ● {task.status}
                          </span>
                          <select
                            value={task.status}
                            onChange={(event) =>
                              handleStatusChange(task.id, event.target.value)
                            }
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        <span className={statusBadgeClass[task.status] || 'status-badge'}>
                          ● {task.status}
                        </span>
                      )}
                    </p>
                    <p>
                      指派給：
                      {isManager ? (
                        <span className="task-status-control">
                          <select
                            value={task.assigned_to_id ?? ''}
                            onChange={(event) =>
                              handleAssigneeChange(task.id, event.target.value)
                            }
                            disabled={assigningTaskId === task.id}
                          >
                            <option value="">未指派</option>
                            {assigneeMissing ? (
                              <option value={task.assigned_to_id}>
                                {task.assigned_to || `使用者 #${task.assigned_to_id}`}
                              </option>
                            ) : null}
                            {users.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.username}（{roleLabels[option.role] || option.role}）
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        task.assigned_to || '未指派'
                      )}
                    </p>
                    {isManager && (
                      <div className="task-actions">
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDeleteTask(task.id, task.title)}
                          disabled={deletingTaskId === task.id}
                        >
                          {deletingTaskId === task.id ? '刪除中…' : '刪除任務'}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default TaskListPage;
