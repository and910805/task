import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const statusOptions = [
  { value: '尚未接單', label: '尚未接單' },
  { value: '已接單', label: '已接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const initialForm = {
  title: '',
  description: '',
  location: '',
  expected_time: '',
  status: '尚未接單',
  assignee_ids: [],
};

const statusFilterOptions = [
  { value: 'all', label: '全部任務' },
  ...statusOptions,
];

const TaskListPage = () => {
  const { user } = useAuth();
  const { labels } = useRoleLabels();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);

  const isManager = managerRoles.has(user?.role);
  const isWorker = user?.role === 'worker';

  const assigneeOptions = useMemo(
    () =>
      users.map((item) => ({
        value: item.id,
        label: `${item.username}（${labels[item.role] || item.role}）`,
      })),
    [users, labels],
  );

  const loadTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get('tasks/');
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

  const loadAvailableTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoadingAvailable(true);
    }
    try {
      const { data } = await api.get('tasks/', { params: { available: 1 } });
      setAvailableTasks(data);
    } catch (err) {
      const message = err.response?.data?.msg || '無法取得可接單任務。';
      setError(message);
    } finally {
      if (showLoading) {
        setLoadingAvailable(false);
      }
    }
  };

  const loadUsers = async () => {
    if (!isManager) return;
    try {
      const { data } = await api.get('auth/assignable-users');
      setUsers(data);
    } catch (err) {
      console.error('無法取得使用者列表', err);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (availableOnly) {
      loadAvailableTasks();
    }
  }, [availableOnly]);

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
        assignee_ids: form.assignee_ids.map(Number),
      };
      await api.post('tasks/create', payload);
      setForm({ ...initialForm });
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
      await api.patch(`tasks/update/${taskId}`, { status: nextStatus });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err.response?.data?.msg || '更新任務狀態失敗。';
      setError(message);
    }
  };

  const handleAssigneesChange = async (taskId, values) => {
    setError('');
    setAssigningTaskId(taskId);
    try {
      await api.patch(`tasks/update/${taskId}`, { assignee_ids: values });
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
      if (availableOnly) {
        await loadAvailableTasks({ showLoading: false });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleAcceptTask = async (taskId) => {
    setError('');
    setAcceptingTaskId(taskId);
    try {
      await api.post(`tasks/${taskId}/accept`);
      await loadTasks({ showLoading: false });
      if (availableOnly) {
        await loadAvailableTasks({ showLoading: false });
      }
    } catch (err) {
      const message = err.response?.data?.msg || '接單失敗。';
      setError(message);
    } finally {
      setAcceptingTaskId(null);
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
      await api.delete(`tasks/${taskId}`);
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err.response?.data?.msg || '刪除任務失敗。';
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    if (availableOnly) {
      return availableTasks;
    }
    if (statusFilter === 'all') {
      return tasks;
    }
    return tasks.filter((task) => task.status === statusFilter);
  }, [availableOnly, availableTasks, statusFilter, tasks]);

  const statusBadgeClass = {
    尚未接單: 'status-badge status-pending',
    已接單: 'status-badge status-in-progress',
    進行中: 'status-badge status-in-progress',
    已完成: 'status-badge status-completed',
  };

  const headerActions = isManager ? (
    <div className="task-toolbar">
      <label>
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => setAvailableOnly(event.target.checked)}
        />
        只顯示可接單
      </label>
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
    <div className="task-toolbar">
      <label>
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => setAvailableOnly(event.target.checked)}
        />
        只顯示可接單
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? '刷新中…' : '🔄 刷新任務'}
      </button>
    </div>
  );

  const emptyStateMessage =
    availableOnly
      ? '目前沒有可接單任務。'
      : statusFilter === 'all'
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
              {isManager ? (
                <label>
                  指派給
                  <Select
                    isMulti
                    classNamePrefix="assignee-select"
                    placeholder="選擇負責人（可複選）"
                    options={assigneeOptions}
                    value={assigneeOptions.filter((option) =>
                      form.assignee_ids.includes(option.value),
                    )}
                    onChange={(selected) =>
                      setForm((prev) => ({
                        ...prev,
                        assignee_ids: (selected || []).map((option) => option.value),
                      }))
                    }
                    isClearable
                    closeMenuOnSelect={false}
                  />
                </label>
              ) : null}
              <button type="submit">建立任務</button>
            </form>
          )}
        </section>
      )}
      {error && <p className="error-text">{error}</p>}
      <section className="panel">
        <h2>任務列表</h2>
        {loading || (availableOnly && loadingAvailable) ? (
          <p>載入中...</p>
        ) : filteredTasks.length === 0 ? (
          <p>{emptyStateMessage}</p>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const taskAssigneeIds = task.assignee_ids || [];
              const assignedUsers = task.assignees || [];
              const selectValue = assigneeOptions.filter((option) =>
                taskAssigneeIds.includes(option.value),
              );
              const isOverdue =
                task.is_overdue ||
                (task.due_date &&
                  task.status !== '已完成' &&
                  new Date(task.due_date).getTime() < Date.now());
              const canAccept =
                isWorker && task.status === '尚未接單' && !task.assigned_to_id;
              const hasMissingAssignee =
                isManager &&
                taskAssigneeIds.length > 0 &&
                selectValue.length !== taskAssigneeIds.length;
              const dueDateLabel = task.due_date || task.expected_time;
              const dueDateText = dueDateLabel
                ? new Date(dueDateLabel).toLocaleString()
                : '未設定';
              return (
                <li key={task.id} className="task-item">
                  <div className="task-card">
                    <div className="task-card__header">
                      <h3>
                        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                      </h3>
                      <div className="task-card__status">
                        <span className={statusBadgeClass[task.status] || 'status-badge'}>
                          ● {task.status}
                        </span>
                        {isOverdue && (
                          <span className="status-badge status-overdue">⚠️ 逾期</span>
                        )}
                      </div>
                    </div>
                    <div className="task-card__meta">
                      <span>地點：{task.location}</span>
                      <span>截止日期：{dueDateText}</span>
                    </div>
                    <div className="task-card__cta">
                      {isManager ? (
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
                      ) : canAccept ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleAcceptTask(task.id)}
                          disabled={acceptingTaskId === task.id}
                        >
                          {acceptingTaskId === task.id ? '接單中…' : '接單'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="task-details">
                    <h3 className="task-title">
                      <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                    </h3>
                    <p className="task-secondary">{task.description || '沒有描述'}</p>
                    <p className="task-secondary">地點：{task.location}</p>
                    <p className="task-secondary">
                      預計完成：
                      {task.expected_time
                        ? new Date(task.expected_time).toLocaleString()
                        : '未設定'}
                    </p>
                    <p className="task-secondary">
                      總工時：{(task.total_work_hours ?? 0).toFixed(2)} 小時
                    </p>
                    <p className="task-status-row">
                      任務進度：
                      {isManager ? (
                        <span className="task-status-control">
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ● {task.status}
                          </span>
                          {isOverdue && (
                            <span className="status-badge status-overdue">⚠️ 逾期</span>
                          )}
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
                        <>
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ● {task.status}
                          </span>
                          {isOverdue && (
                            <span className="status-badge status-overdue">⚠️ 逾期</span>
                          )}
                          {canAccept && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleAcceptTask(task.id)}
                              disabled={acceptingTaskId === task.id}
                            >
                              {acceptingTaskId === task.id ? '接單中…' : '接單'}
                            </button>
                          )}
                        </>
                      )}
                    </p>
                    <div>
                      <strong>指派對象：</strong>
                      {assignedUsers.length > 0 ? (
                        <div className="chip-list">
                          {assignedUsers.map((assignee) => (
                            <span key={assignee.id} className="chip">
                              {assignee.username}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="hint-text">未指派</span>
                      )}
                      {hasMissingAssignee ? (
                        <p className="error-text">部分指派對象已被移除</p>
                      ) : null}
                    </div>
                    {isManager && (
                      <div className="task-actions">
                        <div className="task-toolbar">
                          <div style={{ minWidth: '220px' }}>
                            <Select
                              isMulti
                              classNamePrefix="assignee-select"
                              placeholder="選擇負責人"
                              options={assigneeOptions}
                              value={selectValue}
                              onChange={(selected) =>
                                handleAssigneesChange(
                                  task.id,
                                  (selected || []).map((option) => option.value),
                                )
                              }
                              isDisabled={assigningTaskId === task.id}
                              isLoading={assigningTaskId === task.id}
                              closeMenuOnSelect={false}
                            />
                          </div>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDeleteTask(task.id, task.title)}
                            disabled={deletingTaskId === task.id}
                          >
                            {deletingTaskId === task.id ? '刪除中…' : '刪除任務'}
                          </button>
                        </div>
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
