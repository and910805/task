import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const STATUS_PENDING = '撠?亙';
const STATUS_IN_PROGRESS = '撌脫??';
const STATUS_WORKING = '?脰?銝?';
const STATUS_DONE = '撌脣???';

const statusLabels = {
  [STATUS_PENDING]: '待指派',
  [STATUS_IN_PROGRESS]: '進行中',
  [STATUS_WORKING]: '施工中',
  [STATUS_DONE]: '已完成',
};

const statusOptions = [
  { value: STATUS_PENDING, label: statusLabels[STATUS_PENDING] },
  { value: STATUS_IN_PROGRESS, label: statusLabels[STATUS_IN_PROGRESS] },
  { value: STATUS_WORKING, label: statusLabels[STATUS_WORKING] },
  { value: STATUS_DONE, label: statusLabels[STATUS_DONE] },
];

const initialForm = {
  title: '',
  description: '',
  location: '',
  location_url: '',
  expected_time: '',
  status: STATUS_PENDING,
  assignee_ids: [],
};

const TaskListPage = () => {
  const { user } = useAuth();
  const { labels } = useRoleLabels();
  const isManager = managerRoles.has(user?.role);
  const isWorker = user?.role === 'worker';

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [siteLocations, setSiteLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);

  const getErrorMessage = (err, fallback) =>
    err?.networkMessage || err?.response?.data?.msg || fallback;

  const assigneeOptions = useMemo(
    () =>
      users.map((item) => ({
        value: item.id,
        label: `${item.username}（${labels[item.role] || item.role}）`,
      })),
    [users, labels],
  );

  const locationOptions = useMemo(
    () =>
      siteLocations.map((location) => ({
        value: location.name,
        label: location.name,
        map_url: location.map_url || null,
      })),
    [siteLocations],
  );

  const selectedLocation = useMemo(() => {
    if (!form.location) return null;
    return (
      locationOptions.find((option) => option.value === form.location) || {
        value: form.location,
        label: form.location,
      }
    );
  }, [form.location, locationOptions]);

  const loadTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError('');
    try {
      const params = {
        summary: 1,
        page,
        page_size: pageSize,
      };
      if (availableOnly) {
        params.available = 1;
      }
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      const trimmedSearch = searchQuery.trim();
      if (trimmedSearch) {
        params.q = trimmedSearch;
      }
      const { data } = await api.get('tasks/', { params });
      const items = Array.isArray(data) ? data : data.items || [];
      setTasks(items);
      if (!Array.isArray(data)) {
        setTotalPages(data.pages || 1);
        setTotalCount(data.total || items.length);
        setPage(data.page || 1);
      } else {
        setTotalPages(1);
        setTotalCount(items.length);
        setPage(1);
      }
    } catch (err) {
      const message = getErrorMessage(err, '載入任務失敗。');
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
      const { data } = await api.get('auth/assignable-users');
      setUsers(data);
    } catch (err) {
      console.error('載入人員失敗', err);
    }
  };

  const loadSiteLocations = async () => {
    if (!isManager) return;
    setLoadingLocations(true);
    try {
      const { data } = await api.get('site-locations');
      const list = Array.isArray(data) ? data : data?.locations ?? [];
      setSiteLocations(list);
    } catch (err) {
      console.error('載入地點失敗', err);
    } finally {
      setLoadingLocations(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [availableOnly, statusFilter, searchQuery, page, pageSize]);

  useEffect(() => {
    loadUsers();
  }, [isManager]);

  useEffect(() => {
    loadSiteLocations();
  }, [isManager]);

  useEffect(() => {
    setPage(1);
  }, [availableOnly, statusFilter, searchQuery]);

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
    const trimmedLocationUrl = form.location_url.trim();

    if (!trimmedTitle || !trimmedDescription || !trimmedLocation || !form.expected_time) {
      setError('請填寫所有必填欄位。');
      return;
    }

    const expectedDate = new Date(form.expected_time);
    if (Number.isNaN(expectedDate.getTime())) {
      setError('時間格式不正確。');
      return;
    }

    try {
      const payload = {
        title: trimmedTitle,
        description: trimmedDescription,
        location: trimmedLocation,
        location_url: trimmedLocationUrl || null,
        expected_time: expectedDate.toISOString(),
        status: form.status,
        assignee_ids: form.assignee_ids.map(Number),
      };
      await api.post('tasks/create', payload);
      setForm({ ...initialForm });
      setCreating(false);
      await loadTasks();
    } catch (err) {
      const message = getErrorMessage(err, '新增任務失敗。');
      setError(message);
    }
  };

  const handleStatusChange = async (taskId, nextStatus) => {
    setError('');
    try {
      await api.patch(`tasks/update/${taskId}`, { status: nextStatus });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '更新狀態失敗。');
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
      const message = getErrorMessage(err, '更新指派失敗。');
      setError(message);
    } finally {
      setAssigningTaskId(null);
    }
  };

  const handleRefresh = async () => {
    setError('');
    setRefreshing(true);
    try {
      await loadTasks({ showLoading: false });
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
    } catch (err) {
      const message = getErrorMessage(err, '接受任務失敗。');
      setError(message);
    } finally {
      setAcceptingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId, taskTitle) => {
    const confirmed = window.confirm(`確定要刪除「${taskTitle}」嗎？`);
    if (!confirmed) {
      return;
    }

    setError('');
    setDeletingTaskId(taskId);
    try {
      await api.delete(`tasks/${taskId}`);
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '刪除任務失敗。');
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (statusFilter !== 'all') {
      result = result.filter((task) => task.status === statusFilter);
    }
    return result;
  }, [statusFilter, tasks]);

  const headerActions = (
    <div className="task-toolbar task-toolbar--aligned">
      <label className="task-toolbar__item">
        <span className="task-toolbar__label">可接任務</span>
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => setAvailableOnly(event.target.checked)}
        />
      </label>
      <label className="task-toolbar__item">
        <span className="task-toolbar__label">狀態</span>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">全部</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="task-toolbar__item task-toolbar__item--grow">
        <span className="task-toolbar__label">搜尋</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="標題或描述"
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? '更新中...' : '重新整理'}
      </button>
    </div>
  );

  return (
    <div className="page">
      <AppHeader
        title="任務清單"
        subtitle="快速掌握任務狀態"
        actions={headerActions}
      />
      {isManager && (
        <section className="panel">
          <button type="button" onClick={() => setCreating((prev) => !prev)}>
            {creating ? '收起新增表單' : '新增任務'}
          </button>
          {creating && (
            <form className="stack" onSubmit={handleCreate}>
              <label>
                標題
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="請輸入任務標題"
                  required
                />
              </label>
              <label>
                描述
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="請輸入任務描述"
                  required
                />
              </label>
              <label>
                地點
                <CreatableSelect
                  classNamePrefix="location-select"
                  placeholder="選擇或輸入地點"
                  options={locationOptions}
                  value={selectedLocation}
                  isClearable
                  isSearchable
                  isLoading={loadingLocations}
                  formatCreateLabel={(value) => `新增「${value}」`}
                  noOptionsMessage={() => '尚無地點'}
                  onChange={(option) =>
                    setForm((prev) => ({ ...prev, location: option?.value || '' }))
                  }
                  onCreateOption={(inputValue) =>
                    setForm((prev) => ({ ...prev, location: inputValue }))
                  }
                />
              </label>
              <label>
                地點連結
                <input
                  type="url"
                  name="location_url"
                  value={form.location_url}
                  onChange={handleChange}
                  placeholder="選填 Google Maps 連結"
                />
              </label>
              <label>
                預計時間
                <input
                  type="datetime-local"
                  name="expected_time"
                  value={form.expected_time}
                  onChange={handleChange}
                  required
                />
              </label>
              <label>
                狀態
                <select name="status" value={form.status} onChange={handleChange}>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                指派人員
                <Select
                  isMulti
                  classNamePrefix="assignee-select"
                  placeholder="選擇指派人員"
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
              <button type="submit">送出新增</button>
            </form>
          )}
        </section>
      )}
      {error && (
        <div className="error-text" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={handleRefresh}>
            重新整理
          </button>
        </div>
      )}
      <section className="panel">
        <h2>任務列表</h2>
        {loading ? (
          <p>載入中...</p>
        ) : filteredTasks.length === 0 ? (
          <p>目前沒有符合條件的任務。</p>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const taskAssigneeIds = task.assignee_ids || [];
              const assignedUsers = task.assignees || [];
              const selectValue = assigneeOptions.filter((option) =>
                taskAssigneeIds.includes(option.value),
              );
              const canAccept =
                isWorker && task.status === STATUS_PENDING && !task.assigned_to_id;
              return (
                <li key={task.id} className="task-item">
                  <div className="task-card">
                    <div className="task-card__header">
                      <h3>
                        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                      </h3>
                      <span className="status-badge">
                        {statusLabels[task.status] || task.status}
                      </span>
                    </div>
                    <div className="task-card__meta">
                      <span>{task.location}</span>
                      <span>
                        到期：
                        {task.due_date
                          ? new Date(task.due_date).toLocaleString()
                          : '未設定'}
                      </span>
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
                          {acceptingTaskId === task.id ? '處理中...' : '接受'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="task-details">
                    <p>{task.description || '未填寫描述'}</p>
                    <div>
                      <strong>指派人員</strong>
                      {assignedUsers.length > 0 ? (
                        <div className="chip-list">
                          {assignedUsers.map((assignee) => (
                            <span key={assignee.id} className="chip">
                              {assignee.username}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="hint-text">尚未指派</span>
                      )}
                    </div>
                    {isManager && (
                      <div className="task-actions">
                        <div className="task-toolbar">
                          <div style={{ minWidth: '220px' }}>
                            <Select
                              isMulti
                              classNamePrefix="assignee-select"
                              placeholder="指派人員"
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
                            {deletingTaskId === task.id ? '刪除中...' : '刪除'}
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
        <div className="pagination">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
          >
            上一頁
          </button>
          <span>
            第 {page} / {totalPages} 頁 · 共 {totalCount} 筆
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
          >
            下一頁
          </button>
          <label>
            每頁
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 30, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </div>
  );
};

export default TaskListPage;
