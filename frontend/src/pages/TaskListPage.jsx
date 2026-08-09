import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

const calendarWeekLabels = ['日', '一', '二', '三', '四', '五', '六'];

const toDateOnlyKey = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTaskCalendarDate = (task) => task?.expected_time || task?.due_date || null;

const getTaskCalendarTimestamp = (task) => {
  const raw = getTaskCalendarDate(task);
  if (!raw) return Number.POSITIVE_INFINITY;
  const ts = new Date(raw).getTime();
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
};

const getMonthAnchor = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

const TaskListPage = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { labels } = useRoleLabels();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');
  const [siteLocations, setSiteLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');
  const [sortOption, setSortOption] = useState('due_soon');
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);
  const hasNotificationPreference = user?.notification_type && user?.notification_type !== 'none';
  const [showOverdue, setShowOverdue] = useState(Boolean(hasNotificationPreference));
  const [viewMode, setViewMode] = useState('list');
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthAnchor());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toDateOnlyKey(new Date()));

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

  const loadTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(data);
    } catch (err) {
      const message = getErrorMessage(err, '無法取得任務列表。');
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
      const message = getErrorMessage(err, '無法取得可接單任務。');
      setError(message);
    } finally {
      if (showLoading) {
        setLoadingAvailable(false);
      }
    }
  };

  const loadUsers = async () => {
    if (!isManager && !isWorker) return;
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
  }, []);

  useEffect(() => {
    if (availableOnly) {
      loadAvailableTasks();
    }
  }, [availableOnly]);

  useEffect(() => {
    loadUsers();
  }, [isManager, isWorker]);

  useEffect(() => {
    loadSiteLocations();
  }, [isManager]);

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

  const handleAssigneesChange = async (task, values) => {
    setError('');
    setAssigningTaskId(task.id);
    try {
      if (isManager) {
        await api.patch(`tasks/update/${task.id}`, { assignee_ids: values });
      } else if (isWorker && (task.assignee_ids || []).includes(user?.id)) {
        await api.post(`tasks/${task.id}/assignees/add`, { assignee_ids: values });
      } else {
        throw new Error('你沒有新增派工人員的權限');
      }
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = err?.message || getErrorMessage(err, '更新指派對象失敗。');
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
    let result = availableOnly ? availableTasks : tasks;

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
    availableTasks,
    locationFilter,
    sortOption,
    statusFilter,
    tasks,
  ]);

  const tasksByCalendarDate = useMemo(() => {
    const map = new Map();
    filteredTasks.forEach((task) => {
      const raw = getTaskCalendarDate(task);
      const key = toDateOnlyKey(raw);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(task);
    });
    for (const [key, list] of map.entries()) {
      map.set(
        key,
        [...list].sort((a, b) => getTaskCalendarTimestamp(a) - getTaskCalendarTimestamp(b)),
      );
    }
    return map;
  }, [filteredTasks]);

  const calendarGridDates = useMemo(() => {
    const monthStart = getMonthAnchor(calendarMonth);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = toDateOnlyKey(date);
      const inCurrentMonth = date.getMonth() === monthStart.getMonth();
      const isToday = key === toDateOnlyKey(new Date());
      const isSelected = key === selectedCalendarDate;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const dayTasks = tasksByCalendarDate.get(key) || [];
      return {
        date,
        key,
        inCurrentMonth,
        isToday,
        isSelected,
        isWeekend,
        dayTasks,
      };
    });
  }, [calendarMonth, selectedCalendarDate, tasksByCalendarDate]);

  const selectedDateTasks = useMemo(
    () => tasksByCalendarDate.get(selectedCalendarDate) || [],
    [selectedCalendarDate, tasksByCalendarDate],
  );

  const mobileOverdueTasks = useMemo(
    () =>
      filteredTasks
        .filter((task) => {
          const dueDate = task.due_date || task.expected_time;
          if (task.is_overdue) return true;
          if (!dueDate) return false;
          const dueTime = new Date(dueDate).getTime();
          return !Number.isNaN(dueTime) && dueTime < Date.now();
        })
        .slice(0, 3),
    [filteredTasks],
  );

  const mobileAssignedCount = useMemo(
    () =>
      filteredTasks.reduce((total, task) => {
        const assigneeCount =
          task.assignees?.length ||
          task.assignee_ids?.length ||
          (task.assigned_to_id ? 1 : 0);
        return total + assigneeCount;
      }, 0),
    [filteredTasks],
  );

  const mobileUnassignedCount = useMemo(
    () =>
      filteredTasks.filter(
        (task) =>
          !task.assigned_to_id &&
          (task.assignee_ids || []).length === 0 &&
          (task.assignees || []).length === 0,
      ).length,
    [filteredTasks],
  );

  const selectedDateLabel = useMemo(() => {
    if (!selectedCalendarDate) return '';
    const parsed = new Date(`${selectedCalendarDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return selectedCalendarDate;
    return parsed.toLocaleDateString();
  }, [selectedCalendarDate]);

  const selectedDateWeekdayLabel = useMemo(() => {
    if (!selectedCalendarDate) return '';
    const parsed = new Date(`${selectedCalendarDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return `星期${calendarWeekLabels[parsed.getDay()]}`;
  }, [selectedCalendarDate]);

  const calendarMonthLabel = useMemo(() => {
    const monthStart = getMonthAnchor(calendarMonth);
    return monthStart.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
    });
  }, [calendarMonth]);

  const moveCalendarMonth = (deltaMonths) => {
    const anchor = getMonthAnchor(calendarMonth);
    const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + deltaMonths, 1);
    setCalendarMonth(nextMonth);
    setSelectedCalendarDate((prev) => {
      if (!prev) return toDateOnlyKey(nextMonth);
      const parsed = new Date(`${prev}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return toDateOnlyKey(nextMonth);
      if (
        parsed.getFullYear() === nextMonth.getFullYear() &&
        parsed.getMonth() === nextMonth.getMonth()
      ) {
        return prev;
      }
      return toDateOnlyKey(nextMonth);
    });
  };

  const goToCurrentMonth = () => {
    const now = new Date();
    setCalendarMonth(getMonthAnchor(now));
    setSelectedCalendarDate(toDateOnlyKey(now));
  };

  const toolbarFilters = (
    <>
      <label>
        檢視模式
        <select
          value={viewMode}
          onChange={(event) => setViewMode(event.target.value)}
        >
          <option value="list">列表</option>
          <option value="calendar">月曆</option>
        </select>
      </label>
      <label>
        地點搜尋
        <input
          type="search"
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          placeholder="輸入地點關鍵字"
        />
      </label>
      <label>
        排序方式
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

  const calendarEventToneClass = {
    尚未接單: 'task-calendar-event--pending',
    已接單: 'task-calendar-event--queued',
    進行中: 'task-calendar-event--progress',
    已完成: 'task-calendar-event--done',
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

  const calendarView = (
    <div className="task-calendar-view">
      <div className="task-calendar-toolbar">
        <div className="task-calendar-toolbar__left">
          <div className="task-calendar-nav">
            <button type="button" className="secondary-button" onClick={() => moveCalendarMonth(-1)}>
              上個月
            </button>
            <button type="button" className="secondary-button" onClick={goToCurrentMonth}>
              今天
            </button>
            <button type="button" className="secondary-button" onClick={() => moveCalendarMonth(1)}>
              下個月
            </button>
          </div>
          <div className="task-calendar-toolbar__month">{calendarMonthLabel}</div>
        </div>
        <div className="task-calendar-toolbar__meta">
          <span className="hint-text">月曆視圖</span>
          <span className="hint-text">共 {filteredTasks.length} 筆任務</span>
        </div>
      </div>

      <div className="task-calendar-layout">
        <div className="task-calendar-board">
          <div className="task-calendar-weekdays">
            {calendarWeekLabels.map((label, idx) => (
              <div
                key={label}
                className={`task-calendar-weekdays__cell${idx === 0 || idx === 6 ? ' is-weekend' : ''}`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="task-calendar-grid">
            {calendarGridDates.map((cell) => {
              const taskCount = cell.dayTasks.length;
              const summaryTasks = cell.dayTasks.slice(0, 3);

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedCalendarDate(cell.key)}
                  className={[
                    'task-calendar-cell',
                    !cell.inCurrentMonth ? 'is-outside' : '',
                    cell.isSelected ? 'is-selected' : '',
                    cell.isWeekend ? 'is-weekend' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="task-calendar-cell__head">
                    <span className={`task-calendar-daynum${cell.isToday ? ' is-today' : ''}`}>
                      {cell.date.getDate()}
                    </span>
                    {taskCount > 0 ? (
                      <span className="task-calendar-cell__count">{taskCount}</span>
                    ) : null}
                  </div>

                  <div className="task-calendar-events">
                    {summaryTasks.map((task) => {
                      const when = getTaskCalendarDate(task);
                      const timeText = when
                        ? new Date(when).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      const toneClass =
                        calendarEventToneClass[task.status] || 'task-calendar-event--default';

                      return (
                        <div
                          key={`calendar-summary-${cell.key}-${task.id}`}
                          className={`task-calendar-event ${toneClass}`}
                          title={`${timeText ? `${timeText} ` : ''}${task.title}`}
                        >
                          <span className="task-calendar-event__dot" />
                          {timeText ? (
                            <span className="task-calendar-event__time">{timeText}</span>
                          ) : null}
                          <span className="task-calendar-event__title">{task.title}</span>
                        </div>
                      );
                    })}

                    {taskCount > summaryTasks.length ? (
                      <div className="task-calendar-more">
                        +{taskCount - summaryTasks.length} 筆
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="task-calendar-daypanel">
          <div className="task-calendar-daypanel__header">
            <div>
              <h3>當日任務</h3>
              <p>
                {selectedDateLabel || selectedCalendarDate}
                {selectedDateWeekdayLabel ? ` · ${selectedDateWeekdayLabel}` : ''}
              </p>
            </div>
            <div className="task-calendar-daypanel__count">{selectedDateTasks.length} 筆</div>
          </div>

          {selectedDateTasks.length === 0 ? (
            <div className="task-calendar-empty">此日期沒有任務。</div>
          ) : (
            <ul className="task-calendar-daylist">
              {selectedDateTasks.map((task) => {
                const when = getTaskCalendarDate(task);
                const whenText = when
                  ? new Date(when).toLocaleString([], {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '未設定時間';
                const assignedUsers = task.assignees || [];
                const toneClass =
                  calendarEventToneClass[task.status] || 'task-calendar-event--default';

                return (
                  <li key={`selected-day-task-${task.id}`} className="task-calendar-dayitem">
                    <div className="task-calendar-dayitem__head">
                      <Link to={`/tasks/${task.id}`} className="task-calendar-dayitem__title">
                        {task.title}
                      </Link>
                      <span className={statusBadgeClass[task.status] || 'status-badge'}>
                        {task.status}
                      </span>
                    </div>

                    <div className="task-calendar-dayitem__meta">{task.location || '未設定地點'}</div>
                    <div className="task-calendar-dayitem__meta">時間：{whenText}</div>
                    <div className="task-calendar-dayitem__meta">
                      指派：
                      {assignedUsers.length > 0
                        ? ` ${assignedUsers.map((x) => x.username).join(', ')}`
                        : ' 未指派'}
                    </div>

                    <div className={`task-calendar-dayitem__bar ${toneClass}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );

  return (
    <div className="page task-list-page">
      <AppHeader
        title="任務管理面板"
        subtitle="檢視與指派任務"
        actions={headerActions}
      />
      <section className="mobile-field-summary" aria-label="派工系統行動摘要">
        <div className="mobile-system-strip">Taskgo_line - 專案管理 系統</div>
        <div className="mobile-field-bar">
          <button type="button" className="mobile-icon-button" aria-label="關閉">×</button>
          <strong>TaskGo 現場版</strong>
          <button type="button" className="mobile-icon-button" aria-label="更多">...</button>
        </div>
        <div className="mobile-metric-grid">
          <article className="mobile-metric mobile-metric--blue">
            <span>□</span>
            <strong>{filteredTasks.length}</strong>
            <small>進行中專案</small>
          </article>
          <article className="mobile-metric mobile-metric--teal">
            <span>✓</span>
            <strong>{mobileAssignedCount}</strong>
            <small>進行中任務</small>
          </article>
          <article className="mobile-metric mobile-metric--amber">
            <span>!</span>
            <strong>{mobileUnassignedCount}</strong>
            <small>待處理</small>
          </article>
        </div>
        <div className="mobile-reminder-card">
          <div className="mobile-reminder-head">
            <strong>△ 任務提醒</strong>
            <span>逾期 {mobileOverdueTasks.length}</span>
          </div>
          {mobileOverdueTasks.length === 0 ? (
            <p className="mobile-empty-note">目前沒有逾期任務</p>
          ) : (
            <ul>
              {mobileOverdueTasks.map((task) => (
                <li key={`mobile-overdue-${task.id}`}>
                  <Link to={`/tasks/${task.id}`}>
                    <span>△ 逾期</span>
                    <strong>{task.title}</strong>
                    <small>{task.location || '未設定地點'}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {isManager && (
        <section className="panel task-create-panel">
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
      <section className="panel task-dispatch-panel">
        <h2>任務列表</h2>
        {loading || (availableOnly && loadingAvailable) ? (
          <p>載入中...</p>
        ) : filteredTasks.length === 0 ? (
          <p>{emptyStateMessage}</p>
        ) : viewMode === 'calendar' ? (
          calendarView
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const taskAssigneeIds = Array.from(
                new Set([...(task.assignee_ids || []), ...(task.assigned_to_id ? [task.assigned_to_id] : [])]),
              );
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
              const canAssistAssign = isWorker && taskAssigneeIds.includes(user?.id);
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
                      總工時：{(task.total_work_hours ?? 0).toFixed(2)} 小時
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
                    {(isManager || canAssistAssign) && (
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
                                  task,
                                  (selected || []).map((option) => option.value),
                                )
                              }
                              isDisabled={assigningTaskId === task.id}
                              isLoading={assigningTaskId === task.id}
                              closeMenuOnSelect={false}
                            />
                          </div>
                          {isManager && (
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDeleteTask(task.id, task.title)}
                            disabled={deletingTaskId === task.id}
                          >
                            {deletingTaskId === task.id ? '刪除中…' : '刪除任務'}
                          </button>
                          )}
                        </div>
                        {canAssistAssign && !isManager && (
                          <p className="hint-text">現場人員僅可補加派工，既有指派名單會保留。</p>
                        )}
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
