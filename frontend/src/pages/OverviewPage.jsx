import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const statusLabels = {
  '撠?亙': '待指派',
  '撌脫??': '進行中',
  '?脰?銝?': '施工中',
  '撌脣???': '已完成',
};

const OverviewPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('dashboard/overview');
      setData(response.data);
    } catch (err) {
      setError(err?.response?.data?.msg || '載入派工總覽失敗。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const todayTasks = useMemo(() => data?.today_tasks || [], [data]);
  const assigneeSummary = useMemo(() => data?.today_by_assignee || [], [data]);
  const counts = data?.counts || {};

  return (
    <div className="page">
      <AppHeader title="今日派工總覽" subtitle="快速掌握今天的任務安排" />
      {error ? <div className="error-text">{error}</div> : null}
      <section className="panel panel--metrics">
        {loading ? (
          <p>載入中...</p>
        ) : (
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__value">{counts.total ?? 0}</div>
              <div className="metric-card__title">全部任務</div>
              <div className="metric-card__hint">今日總量</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__value">{counts.pending ?? 0}</div>
              <div className="metric-card__title">待指派</div>
              <div className="metric-card__hint">尚未指派</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__value">{counts.in_progress ?? 0}</div>
              <div className="metric-card__title">進行中</div>
              <div className="metric-card__hint">已接案</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__value">{counts.working ?? 0}</div>
              <div className="metric-card__title">施工中</div>
              <div className="metric-card__hint">正在處理</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__value">{counts.done ?? 0}</div>
              <div className="metric-card__title">已完成</div>
              <div className="metric-card__hint">今日結案</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__value">{counts.overdue ?? 0}</div>
              <div className="metric-card__title">逾期</div>
              <div className="metric-card__hint">需要關注</div>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>今日任務</h2>
          <button type="button" className="secondary-button" onClick={loadOverview}>
            重新整理
          </button>
        </div>
        {loading ? (
          <p>載入中...</p>
        ) : todayTasks.length === 0 ? (
          <p>今日沒有安排任務。</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>任務</th>
                  <th>狀態</th>
                  <th>地點</th>
                  <th>時間</th>
                  <th>人員</th>
                </tr>
              </thead>
              <tbody>
                {todayTasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td>{statusLabels[task.status] || task.status}</td>
                    <td>{task.location || '-'}</td>
                    <td>{task.due_time ? new Date(task.due_time).toLocaleString() : '-'}</td>
                    <td>
                      {(task.assignees || []).length > 0
                        ? task.assignees.map((item) => item.username).join('、')
                        : '未指派'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>人員派工量</h2>
        {loading ? (
          <p>載入中...</p>
        ) : assigneeSummary.length === 0 ? (
          <p>今日尚未指派人員。</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人員</th>
                  <th>件數</th>
                </tr>
              </thead>
              <tbody>
                {assigneeSummary.map((item) => (
                  <tr key={item.user_id}>
                    <td>{item.username}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default OverviewPage;
