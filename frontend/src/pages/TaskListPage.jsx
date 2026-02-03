import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

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
  location_url: '',
  expected_time: '',
  status: '尚未接單',
  assignee_ids: [],
};

const statusFilterOptions = [
  { value: 'all', label: '全部任務' },
  ...statusOptions,
];

const sortOptions = [
  { value: 'due_soon', label: '最近截止' },
  { value: 'created_desc', label: '最新建立' },
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
  const [siteLocations, setSiteLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');
  const [sortOption, setSortOption] = useState('due_soon');
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);
  const hasNotificationPreference = user?.notification_type && user?.notification_type !== 'none';
  const [showOverdue, setShowOverdue] = useState(Boolean(hasNotificationPreference));
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const isManager = managerRoles.has(user?.role);
  const isWorker = user?.role === 'worker';

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

  const loadTasks = async ({ showLoading = true, overrideAvailable } = {}) => {
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
      const useAvailable =
        typeof overrideAvailable === 'boolean' ? overrideAvailable : availableOnly;
      if (useAvailable) {
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
      const message = getErrorMessage(err, '??????????????);
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
      console.error('無法取得使用者列表', err);
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
      console.error('無法取得常用地點', err);
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

  useEffect(() => {
    setShowOverdue(Boolean(hasNotificationPreference));
  }, [hasNotificationPreference]);

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
      const message = getErrorMessage(err, '建立任務失敗。');
      setError(message);
    }
  };

  const handleStatusChange = async (taskId, nextStatus) => {
    setError('');
    try {
      await api.patch(`tasks/update/${taskId}`, { status: nextStatus });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '更新任務狀態失敗。');
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
      const message = getErrorMessage(err, '更新指派對象失敗。');
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
      const message = getErrorMessage(err, '接單失敗。');
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
      const message = getErrorMessage(err, '刪除任務失敗。');
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    const locationQuery = locationFilter.trim().toLowerCase();
    let result = tasks;

    if (statusFilter !== 'all') {
      result = result.filter((task) => task.status === statusFilter);
    }

    if (locationQuery) {
      result = result.filter((task) =>
        (task.location || '').toLowerCase().includes(locationQuery),
      );
    }

    const getDueTimestamp = (task) => {
      const rawDate = task.due_date || task.expected_time;
      if (!rawDate) return Number.POSITIVE_INFINITY;
      const parsed = new Date(rawDate).getTime();
      return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
    };

    const getCreatedTimestamp = (task) => {
      if (!task.created_at) return 0;
      const parsed = new Date(task.created_at).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const sorted = [...result].sort((a, b) => {
      if (sortOption === 'created_desc') {
        return getCreatedTimestamp(b) - getCreatedTimestamp(a);
      }
      return getDueTimestamp(a) - getDueTimestamp(b);
    });

    return sorted;
  }, [
    availableOnly,
    locationFilter,
    sortOption,
    statusFilter,
    tasks,
  ]);

  const toolbarFilters = (
    <>
      <label>
        Search
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Title or description"
        />
      </label>
      <label>
        Location
        <input
          type="search"
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          placeholder="Filter by location"
        />
      </label>
      <label>
        Sort
        <select
          value={sortOption}
          onChange={(event) => setSortOption(event.target.value)}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );

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
        <input
          type="checkbox"
          checked={showOverdue}
          onChange={(event) => setShowOverdue(event.target.checked)}
        />
        顯示逾期提醒
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
      {toolbarFilters}
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
      <label>
        <input
          type="checkbox"
          checked={showOverdue}
          onChange={(event) => setShowOverdue(event.target.checked)}
        />
        顯示逾期提醒
      </label>
      {toolbarFilters}
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
                <CreatableSelect
                  classNamePrefix="location-select"
                  placeholder="選擇或搜尋常用地點"
                  options={locationOptions}
                  value={selectedLocation}
                  isClearable
                  isSearchable
                  isLoading={loadingLocations}
                  formatCreateLabel={(value) => `新增「${value}」`}
                  noOptionsMessage={() => '沒有符合的地點'}
                  onChange={(option) =>
                    setForm((prev) => ({ ...prev, location: option?.value || '' }))
                  }
                  onCreateOption={(inputValue) =>
                    setForm((prev) => ({ ...prev, location: inputValue }))
                  }
                />
                {selectedLocation?.map_url ? (
                  <a
                    href={selectedLocation.map_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-link"
                  >
                    查看 Google Maps
                  </a>
                ) : null}
              </label>
              <label>
                地圖連結
                <input
                  type="url"
                  name="location_url"
                  value={form.location_url}
                  onChange={handleChange}
                  placeholder="可貼上 Google 地圖連結"
                />
              </label>
              <label>
                地圖連結
                <input
                  type="url"
                  name="location_url"
                  value={form.location_url}
                  onChange={handleChange}
                  placeholder="可貼上 Google 地圖連結"
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
      {error && (
        <div className="error-text" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={handleRefresh}>
            重試
          </button>
        </div>
      )}
      <section className="panel">
        <h2>任務列表</h2>
        {loading ? (
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
              const showOverdueIndicator = showOverdue && isOverdue;
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
                <li
                  key={task.id}
                  className={`task-item${showOverdueIndicator ? ' task-overdue' : ''}`}
                >
                  <div className="task-card">
                    <div className="task-card__header">
                      <h3>
                        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                      </h3>
                      <div className="task-card__status">
                        <span className={statusBadgeClass[task.status] || 'status-badge'}>
                          ● {task.status}
                        </span>
                        {showOverdueIndicator && (
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
                      ????{typeof task.total_work_hours === 'number' ? task.total_work_hours.toFixed(2) : '-'} ??
                    </p>
                    <p className="task-status-row">
                      任務進度：
                      {isManager ? (
                        <span className="task-status-control">
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ● {task.status}
                          </span>
                          {showOverdueIndicator && (
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
                          {showOverdueIndicator && (
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
          <div className="pagination">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
            >
              ???????
            </button>
            <span>
              ? {page} / {totalPages} ? ? ? {totalCount} ?
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
            >
              ???????
            </button>
            <label>
              ??????
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
        )}
      </section>
    </div>
  );
};

export default TaskListPage;
