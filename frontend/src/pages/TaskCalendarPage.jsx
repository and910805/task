import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const VIEW_MODE_OPTIONS = [
  { value: 'month', label: '月檢視' },
  { value: 'week', label: '週檢視' },
];
const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部狀態' },
  { value: '尚未接單', label: '尚未接單' },
  { value: '已接單', label: '已接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const STATUS_BADGE_CLASS = {
  尚未接單: 'status-badge status-pending',
  已接單: 'status-badge status-in-progress',
  進行中: 'status-badge status-in-progress',
  已完成: 'status-badge status-completed',
};

const EVENT_TONE_CLASS = {
  尚未接單: 'task-calendar-event--pending',
  已接單: 'task-calendar-event--queued',
  進行中: 'task-calendar-event--progress',
  已完成: 'task-calendar-event--done',
};

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

const fromDateOnlyKey = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTaskCalendarDate = (task) => task?.expected_time || task?.due_date || null;

const getTaskCalendarTimestamp = (task) => {
  const raw = getTaskCalendarDate(task);
  if (!raw) return Number.POSITIVE_INFINITY;
  const ts = new Date(raw).getTime();
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
};

const getWeekStart = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
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

const formatTimeShort = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatMonthLabel = (value) => {
  const monthStart = getMonthAnchor(value);
  return monthStart.toLocaleDateString([], {
    year: 'numeric',
    month: 'long',
  });
};

const formatWeekRangeLabel = (weekDates) => {
  if (!Array.isArray(weekDates) || weekDates.length === 0) return '';
  const first = weekDates[0]?.date;
  const last = weekDates[weekDates.length - 1]?.date;
  if (!(first instanceof Date) || !(last instanceof Date)) return '';
  const sameYear = first.getFullYear() === last.getFullYear();
  const left = first.toLocaleDateString([], sameYear ? { month: '2-digit', day: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' });
  const right = last.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${left} - ${right}`;
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
  const [viewMode, setViewMode] = useState('month');
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

  const selectCalendarDate = (value) => {
    const date = value instanceof Date ? value : fromDateOnlyKey(value);
    if (!date || Number.isNaN(date.getTime())) return;
    setSelectedCalendarDate(toDateOnlyKey(date));
    setCalendarMonth(getMonthAnchor(date));
  };

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

  const weekDates = useMemo(() => {
    const selectedDate = fromDateOnlyKey(selectedCalendarDate) || new Date();
    const weekStart = getWeekStart(selectedDate);
    const todayKey = toDateOnlyKey(new Date());

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      const key = toDateOnlyKey(date);
      return {
        date,
        key,
        isToday: key === todayKey,
        isSelected: key === selectedCalendarDate,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        dayTasks: tasksByCalendarDate.get(key) || [],
      };
    });
  }, [selectedCalendarDate, tasksByCalendarDate]);

  const selectedDateTasks = useMemo(
    () => tasksByCalendarDate.get(selectedCalendarDate) || [],
    [selectedCalendarDate, tasksByCalendarDate],
  );

  const selectedDateLabel = useMemo(() => {
    const parsed = fromDateOnlyKey(selectedCalendarDate);
    if (!parsed) return selectedCalendarDate || '';
    return parsed.toLocaleDateString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }, [selectedCalendarDate]);

  const selectedDateWeekdayLabel = useMemo(() => {
    const parsed = fromDateOnlyKey(selectedCalendarDate);
    if (!parsed) return '';
    return `星期${WEEKDAY_LABELS[parsed.getDay()]}`;
  }, [selectedCalendarDate]);

  const selectedDateSummary = useMemo(() => {
    let totalHours = 0;
    selectedDateTasks.forEach((task) => {
      const value = Number(task?.total_work_hours || 0);
      if (Number.isFinite(value)) {
        totalHours += value;
      }
    });
    return {
      count: selectedDateTasks.length,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  }, [selectedDateTasks]);

  const periodLabel = useMemo(() => {
    if (viewMode === 'week') {
      return formatWeekRangeLabel(weekDates);
    }
    return formatMonthLabel(calendarMonth);
  }, [viewMode, weekDates, calendarMonth]);

  const navigatePeriod = (delta) => {
    if (viewMode === 'week') {
      const base = fromDateOnlyKey(selectedCalendarDate) || new Date();
      const next = new Date(base);
      next.setDate(next.getDate() + delta * 7);
      selectCalendarDate(next);
      return;
    }

    const anchor = getMonthAnchor(calendarMonth);
    const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    setCalendarMonth(nextMonth);
    setSelectedCalendarDate((prev) => {
      const prevDate = fromDateOnlyKey(prev);
      if (!prevDate) return toDateOnlyKey(nextMonth);
      if (
        prevDate.getFullYear() === nextMonth.getFullYear() &&
        prevDate.getMonth() === nextMonth.getMonth()
      ) {
        return prev;
      }
      return toDateOnlyKey(nextMonth);
    });
  };

  const goToToday = () => {
    selectCalendarDate(new Date());
  };

  const headerActions = (
    <div className="task-toolbar">
      <label>
        檢視
        <div className="task-calendar-view-toggle" role="tablist" aria-label="日曆檢視模式">
          {VIEW_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={viewMode === option.value}
              className={`task-calendar-view-toggle__button${viewMode === option.value ? ' is-active' : ''}`}
              onClick={() => setViewMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </label>

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
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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

  const renderMonthBoard = () => (
    <div className="task-calendar-board">
      <div className="task-calendar-weekdays">
        {WEEKDAY_LABELS.map((label, idx) => (
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
              onClick={() => selectCalendarDate(cell.date)}
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
                {taskCount > 0 ? <span className="task-calendar-cell__count">{taskCount}</span> : null}
              </div>

              <div className="task-calendar-events">
                {summaryTasks.map((task) => {
                  const toneClass = EVENT_TONE_CLASS[task.status] || 'task-calendar-event--default';
                  const timeText = formatTimeShort(getTaskCalendarDate(task));

                  return (
                    <div
                      key={`month-${cell.key}-${task.id}`}
                      className={`task-calendar-event ${toneClass}`}
                      title={`${timeText ? `${timeText} ` : ''}${task.title}`}
                    >
                      <span className="task-calendar-event__dot" />
                      {timeText ? <span className="task-calendar-event__time">{timeText}</span> : null}
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
  );

  const renderWeekBoard = () => (
    <div className="task-calendar-weekboard">
      <div className="task-calendar-weekstrip">
        {weekDates.map((day) => {
          const taskCount = day.dayTasks.length;

          return (
            <section
              key={day.key}
              className={[
                'task-calendar-weekcol',
                day.isSelected ? 'is-selected' : '',
                day.isToday ? 'is-today' : '',
                day.isWeekend ? 'is-weekend' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="task-calendar-weekcol__header"
                onClick={() => selectCalendarDate(day.date)}
              >
                <span className="task-calendar-weekcol__weekday">{WEEKDAY_LABELS[day.date.getDay()]}</span>
                <span className="task-calendar-weekcol__date">{day.date.getDate()}</span>
                {taskCount > 0 ? (
                  <span className="task-calendar-weekcol__count">{taskCount}</span>
                ) : (
                  <span className="task-calendar-weekcol__count is-empty">0</span>
                )}
              </button>

              <div className="task-calendar-weekcol__subhead">
                {day.date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })}
              </div>

              <div className="task-calendar-weekcol__list">
                {taskCount === 0 ? (
                  <div className="task-calendar-weekcol__empty">無排程</div>
                ) : (
                  day.dayTasks.map((task) => {
                    const toneClass = EVENT_TONE_CLASS[task.status] || 'task-calendar-event--default';
                    const assignees = getTaskAssigneeNames(task);
                    const timeText = formatTimeShort(getTaskCalendarDate(task));

                    return (
                      <article key={`week-${day.key}-${task.id}`} className={`task-calendar-weekitem ${toneClass}`}>
                        <div className="task-calendar-weekitem__row">
                          <span className="task-calendar-weekitem__time">{timeText || '未排時間'}</span>
                          <span className="task-calendar-weekitem__status">{task.status || '未設定'}</span>
                        </div>
                        <Link to={`/tasks/${task.id}`} className="task-calendar-weekitem__title">
                          {task.title}
                        </Link>
                        <div className="task-calendar-weekitem__meta">{task.location || '未填地點'}</div>
                        <div className="task-calendar-weekitem__meta">
                          {assignees.length ? assignees.join(', ') : '未指派'}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );

  const calendarView = (
    <div className="task-calendar-view">
      <div className="task-calendar-toolbar">
        <div className="task-calendar-toolbar__left">
          <div className="task-calendar-nav">
            <button type="button" className="secondary-button" onClick={() => navigatePeriod(-1)}>
              上一{viewMode === 'week' ? '週' : '月'}
            </button>
            <button type="button" className="secondary-button" onClick={goToToday}>
              今天
            </button>
            <button type="button" className="secondary-button" onClick={() => navigatePeriod(1)}>
              下一{viewMode === 'week' ? '週' : '月'}
            </button>
          </div>
          <div className="task-calendar-toolbar__month">{periodLabel}</div>
        </div>

        <div className="task-calendar-toolbar__meta">
          <span className="hint-text">{viewMode === 'week' ? '週檢視' : '月檢視'}</span>
          <span className="hint-text">共 {filteredTasks.length} 筆任務</span>
        </div>
      </div>

      <div className="task-calendar-layout">
        {viewMode === 'week' ? renderWeekBoard() : renderMonthBoard()}

        <aside className="task-calendar-daypanel">
          <div className="task-calendar-daypanel__header">
            <div>
              <h3>當日任務</h3>
              <p>
                {selectedDateLabel || selectedCalendarDate}
                {selectedDateWeekdayLabel ? ` · ${selectedDateWeekdayLabel}` : ''}
              </p>
              <p className="task-calendar-daypanel__subline">
                合計 {selectedDateSummary.count} 筆 / 工時 {selectedDateSummary.totalHours} 小時
              </p>
            </div>
            <div className="task-calendar-daypanel__count">{selectedDateSummary.count}</div>
          </div>

          {selectedDateTasks.length === 0 ? (
            <div className="task-calendar-empty">這一天沒有排程任務。</div>
          ) : (
            <ul className="task-calendar-daylist">
              {selectedDateTasks.map((task) => {
                const toneClass = EVENT_TONE_CLASS[task.status] || 'task-calendar-event--default';
                const assigneeNames = getTaskAssigneeNames(task);

                return (
                  <li key={`selected-day-task-${task.id}`} className="task-calendar-dayitem">
                    <div className="task-calendar-dayitem__head">
                      <Link to={`/tasks/${task.id}`} className="task-calendar-dayitem__title">
                        {task.title}
                      </Link>
                      <span className={STATUS_BADGE_CLASS[task.status] || 'status-badge'}>
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
        subtitle="從 LINE 進入也可直接使用月曆 / 週曆檢視任務排程"
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
