import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const toDateText = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW', { hour12: false });
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const AttendancePage = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    worker: '',
  });

  const loadAttendance = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '出勤資料載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, []);

  const attendanceRecords = useMemo(() => {
    const rows = [];
    for (const task of tasks) {
      const timeEntries = Array.isArray(task.time_entries) ? task.time_entries : [];
      for (const entry of timeEntries) {
        if (!entry?.start_time && !entry?.end_time) continue;
        const anchor = entry.start_time || entry.end_time;
        const anchorDate = new Date(anchor);
        if (Number.isNaN(anchorDate.getTime())) continue;

        rows.push({
          task_id: task.id,
          task_title: task.title || '(未命名任務)',
          worker: entry.author || task.assigned_to || '未指派',
          date: anchorDate.toISOString().slice(0, 10),
          start_time: entry.start_time || null,
          end_time: entry.end_time || null,
          work_hours: toNumber(entry.work_hours),
        });
      }
    }
    return rows;
  }, [tasks]);

  const filteredRecords = useMemo(() => {
    const keyword = filters.worker.trim().toLowerCase();
    return attendanceRecords.filter((row) => {
      if (filters.date_from && row.date < filters.date_from) return false;
      if (filters.date_to && row.date > filters.date_to) return false;
      if (keyword && !row.worker.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [attendanceRecords, filters]);

  const summaryRows = useMemo(() => {
    const map = new Map();
    for (const row of filteredRecords) {
      const key = `${row.date}::${row.worker}`;
      const existing = map.get(key) || {
        date: row.date,
        worker: row.worker,
        total_hours: 0,
        task_ids: new Set(),
      };
      existing.total_hours += row.work_hours;
      existing.task_ids.add(row.task_id);
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((item) => ({
        ...item,
        total_hours: Number(item.total_hours.toFixed(2)),
        task_count: item.task_ids.size,
      }))
      .sort((a, b) => `${b.date}${b.worker}`.localeCompare(`${a.date}${a.worker}`));
  }, [filteredRecords]);

  const stats = useMemo(() => {
    const workerSet = new Set(summaryRows.map((row) => row.worker));
    const totalHours = summaryRows.reduce((sum, row) => sum + row.total_hours, 0);
    return {
      workers: workerSet.size,
      records: filteredRecords.length,
      summaryRows: summaryRows.length,
      totalHours: totalHours.toFixed(2),
    };
  }, [filteredRecords, summaryRows]);

  return (
    <div className="page">
      <AppHeader
        title="出勤中心"
        subtitle="依工時紀錄自動彙整每日人員出勤與工時"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadAttendance} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error && <p className="error-text">{error}</p>}

      <section className="panel panel--metrics">
        <div className="metric-grid">
          <div className="metric-card">
            <p className="metric-label">統計人員</p>
            <h3>{stats.workers}</h3>
          </div>
          <div className="metric-card">
            <p className="metric-label">工時紀錄</p>
            <h3>{stats.records}</h3>
          </div>
          <div className="metric-card">
            <p className="metric-label">彙總列數</p>
            <h3>{stats.summaryRows}</h3>
          </div>
          <div className="metric-card">
            <p className="metric-label">總工時</p>
            <h3>{stats.totalHours}h</h3>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>篩選條件</h2>
        </div>
        <div className="attendance-filter-grid">
          <label>
            起日
            <input
              type="date"
              value={filters.date_from}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
            />
          </label>
          <label>
            迄日
            <input
              type="date"
              value={filters.date_to}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
            />
          </label>
          <label>
            人員關鍵字
            <input
              value={filters.worker}
              onChange={(event) => setFilters((prev) => ({ ...prev, worker: event.target.value }))}
              placeholder="輸入姓名"
            />
          </label>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>每日出勤彙總</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>人員</th>
                <th>任務數</th>
                <th>工時</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={`${row.date}-${row.worker}`}>
                  <td>{row.date}</td>
                  <td>{row.worker}</td>
                  <td>{row.task_count}</td>
                  <td>{row.total_hours.toFixed(2)}</td>
                </tr>
              ))}
              {!loading && summaryRows.length === 0 && (
                <tr>
                  <td colSpan="4">目前無符合條件的出勤資料</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>工時明細</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>人員</th>
                <th>任務</th>
                <th>開始</th>
                <th>結束</th>
                <th>工時</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((row) => (
                <tr key={`${row.task_id}-${row.worker}-${row.start_time}-${row.end_time}`}>
                  <td>{row.date}</td>
                  <td>{row.worker}</td>
                  <td>{row.task_title}</td>
                  <td>{toDateText(row.start_time)}</td>
                  <td>{toDateText(row.end_time)}</td>
                  <td>{row.work_hours.toFixed(2)}</td>
                </tr>
              ))}
              {!loading && filteredRecords.length === 0 && (
                <tr>
                  <td colSpan="6">目前無工時明細</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AttendancePage;
