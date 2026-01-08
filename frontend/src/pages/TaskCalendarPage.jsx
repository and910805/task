import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const formatDateTime = (value) => {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '時間格式錯誤';
  return date.toLocaleString();
};

const TaskCalendarPage = () => {
  const { labels } = useRoleLabels();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTasks = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.msg || '無法載入排程資料。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const workerSchedule = useMemo(() => {
    const workerMap = new Map();
    const loadMap = new Map();

    tasks.forEach((task) => {
      (task.assignee_loads || []).forEach((load) => {
        if (!loadMap.has(load.user_id)) {
          loadMap.set(load.user_id, load);
        }
      });

      const assignees = Array.isArray(task.assignees) ? task.assignees : [];
      const entries = [];
      assignees.forEach((assignee) => {
        if (assignee?.id) {
          entries.push({
            id: assignee.id,
            username: assignee.username,
            role: assignee.role,
          });
        }
      });

      if (task.assigned_to_id && !entries.some((entry) => entry.id === task.assigned_to_id)) {
        entries.push({
          id: task.assigned_to_id,
          username: task.assigned_to || `工人 ${task.assigned_to_id}`,
          role: 'worker',
        });
      }

      if (entries.length === 0) {
        entries.push({
          id: 'unassigned',
          username: '未指派',
          role: 'unassigned',
        });
      }

      entries.forEach((entry) => {
        if (!workerMap.has(entry.id)) {
          workerMap.set(entry.id, {
            ...entry,
            tasks: [],
            load: loadMap.get(entry.id),
          });
        }
        workerMap.get(entry.id).tasks.push(task);
      });
    });

    const list = Array.from(workerMap.values());
    list.forEach((worker) => {
      worker.tasks.sort((a, b) => {
        const aTime = new Date(a.expected_time || 0).getTime();
        const bTime = new Date(b.expected_time || 0).getTime();
        return aTime - bTime;
      });
      if (!worker.load && worker.id !== 'unassigned') {
        worker.load = loadMap.get(worker.id) || { assigned_count: 0, total_work_hours: 0 };
      }
    });

    return list;
  }, [tasks]);

  return (
    <div className="page calendar-page">
      <AppHeader
        title="排程視圖"
        subtitle="檢視各工人預計完成時間、截止日期與工時區間"
      />
      <div className="page-content">
        {loading ? <p className="page-loading">排程資料載入中...</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && !error && workerSchedule.length === 0 ? (
          <p className="empty-state">目前沒有可顯示的排程任務。</p>
        ) : null}
        <div className="calendar-grid">
          {workerSchedule.map((worker) => {
            const load = worker.load || { assigned_count: 0, total_work_hours: 0 };
            const roleLabel =
              worker.role && labels[worker.role] ? labels[worker.role] : worker.role;
            return (
              <section key={worker.id} className="calendar-worker">
                <header className="calendar-worker__header">
                  <div>
                    <h2>{worker.username}</h2>
                    {worker.role && worker.role !== 'unassigned' ? (
                      <span className="calendar-worker__role">{roleLabel}</span>
                    ) : null}
                  </div>
                  {worker.id !== 'unassigned' ? (
                    <div className="calendar-worker__load">
                      負載：{load.assigned_count} 任務 / {load.total_work_hours} 小時
                    </div>
                  ) : null}
                </header>
                <div className="calendar-worker__tasks">
                  {worker.tasks.map((task) => {
                    const timeEntries = (task.time_entries || []).filter((entry) =>
                      worker.id === 'unassigned' ? false : entry.user_id === worker.id
                    );
                    return (
                      <article key={`${task.id}-${worker.id}`} className="calendar-task">
                        <div className="calendar-task__title">
                          <span>{task.title}</span>
                          <span className={`status-pill status-${task.status}`}>
                            {task.status}
                          </span>
                        </div>
                        <div className="calendar-task__meta">
                          <div>預計完成：{formatDateTime(task.expected_time)}</div>
                          <div>截止時間：{formatDateTime(task.due_date || task.expected_time)}</div>
                          <div className="calendar-task__location">
                            地點：{task.location || '未填寫'}
                          </div>
                        </div>
                        <div className="calendar-task__time">
                          <strong>已開始工時區間</strong>
                          {timeEntries.length === 0 ? (
                            <p className="calendar-task__empty">尚無工時紀錄</p>
                          ) : (
                            <ul>
                              {timeEntries.map((entry) => (
                                <li key={entry.id}>
                                  {formatDateTime(entry.start_time)}{' '}
                                  {entry.end_time
                                    ? `~ ${formatDateTime(entry.end_time)}`
                                    : '（進行中）'}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TaskCalendarPage;
