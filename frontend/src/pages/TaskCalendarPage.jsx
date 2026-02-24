import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const calendarWeekLabels = ['日', '一', '二', '三', '四', '五', '六'];

const getMonthAnchor = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

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

const formatDateTime = (value) => {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '時間格式錯誤';
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

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

const getTaskAssigneeNames = (task) => {
  const names = [];
  if (Array.isArray(task?.assignees)) {
    task.assignees.forEach((assignee) => {
      if (assignee?.username) {
        names.push(String(assignee.username));
      }
    });
  }
  if (names.length === 0 && task?.assigned_to) {
    names.push(String(task.assigned_to));
  }
  return names;
};

const TaskCalendarPage = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => getMonthAnchor());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toDateOnlyKey(new Date()));
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadTasks = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.msg || '載入排程失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const assigneeOptions = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      if (Array.isArray(task.assignees)) {
        task.assignees.forEach((assignee) => {
          if (!assignee?.id) return;
          map.set(String(assignee.id), {
            value: String(assignee.id),
            label: assignee.username || `人員 ${assignee.id}`,
          });
        });
      }
      if (task.assigned_to_id && !map.has(String(task.assigned_to_id))) {
        map.set(String(task.assigned_to_id), {
          value: String(task.assigned_to_id),
          label: task.assigned_to || `人員 ${task.assigned_to_id}`,
        });
      }
    });

    return [
      { value: 'all', label: '全部人員' },
      ...Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant')),
    ];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) {
        return false;
      }

      if (assigneeFilter === 'all') {
        return true;
      }

      if (String(task.assigned_to_id || '') === assigneeFilter) {
        return true;
      }

      if (Array.isArray(task.assignees)) {
        return task.assignees.some((assignee) => String(assignee?.id || '') === assigneeFilter);
      }

      return false;
    });
  }, [tasks, assigneeFilter, statusFilter]);

  const tasksByCalendarDate = useMemo(() => {
    const map = new Map();

    filteredTasks.forEach((task) => {
      const key = toDateOnlyKey(getTaskCalendarDate(task));
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
    const todayKey = toDateOnlyKey(new Date());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = toDateOnlyKey(date);
      return {
        date,
        key,
        inCurrentMonth: date.getMonth() === monthStart.getMonth(),
        isToday: key === todayKey,
        isSelected: key === selectedCalendarDate,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        dayTasks: tasksByCalendarDate.get(key) || [],
      };
    });
  }, [calendarMonth, selectedCalendarDate, tasksByCalendarDate]);

  const selectedDateTasks = useMemo(
    () => tasksByCalendarDate.get(selectedCalendarDate) || [],
    [selectedCalendarDate, tasksByCalendarDate],
  );

  const selectedDateLabel = useMemo(() => {
    if (!selectedCalendarDate) return '';
    const parsed = new Date(`${selectedCalendarDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return selectedCalendarDate;
    return parsed.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
  }, [selectedCalendarDate]);

  const selectedDateWeekdayLabel = useMemo(() => {
    if (!selectedCalendarDate) return '';
    const parsed = new Date(`${selectedCalendarDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return `星期${calendarWeekLabels[parsed.getDay()]}`;
  }, [selectedCalendarDate]);

  const calendarMonthLabel = useMemo(() => {
    const monthStart = getMonthAnchor(calendarMonth);
    return monthStart.toLocaleDateString([], {
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

  const headerActions = (
    <div className="task-toolbar">
      <label>
        人員
        <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
          {assigneeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        狀態
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">全部狀態</option>
          <option value="尚未接單">尚未接單</option>
          <option value="已接單">已接單</option>
          <option value="進行中">進行中</option>
          <option value="已完成">已完成</option>
        </select>
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={() => loadTasks({ silent: true })}
        disabled={refreshing || loading}
      >
        {refreshing ? '更新中...' : '重新整理'}
      </button>
    </div>
  );

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
          <span className="hint-text">月檢視</span>
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
                      <div className="task-calendar-more">+{taskCount - summaryTasks.length} 筆</div>
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
            <div className="task-calendar-empty">這一天沒有排程任務。</div>
          ) : (
            <ul className="task-calendar-daylist">
              {selectedDateTasks.map((task) => {
                const toneClass =
                  calendarEventToneClass[task.status] || 'task-calendar-event--default';
                const assigneeNames = getTaskAssigneeNames(task);

                return (
                  <li key={`selected-day-task-${task.id}`} className="task-calendar-dayitem">
                    <div className="task-calendar-dayitem__head">
                      <Link to={`/tasks/${task.id}`} className="task-calendar-dayitem__title">
                        {task.title}
                      </Link>
                      <span className={statusBadgeClass[task.status] || 'status-badge'}>
                        {task.status || '未設定'}
                      </span>
                    </div>

                    <div className="task-calendar-dayitem__meta">{task.location || '未填寫地點'}</div>
                    <div className="task-calendar-dayitem__meta">
                      時間：{formatDateTime(getTaskCalendarDate(task))}
                    </div>
                    <div className="task-calendar-dayitem__meta">
                      指派：{assigneeNames.length ? assigneeNames.join(', ') : '未指派'}
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
    <div className="page calendar-page">
      <AppHeader
        title="排程視圖"
        subtitle="以月曆檢視任務排程，點日期查看當日任務明細"
        actions={headerActions}
      />

      <div className="page-content">
        {loading ? <p className="page-loading">排程載入中...</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && !error ? calendarView : null}
      </div>
    </div>
  );
};

export default TaskCalendarPage;
