import { useEffect, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const StatsPage = () => {
  const { labels } = useRoleLabels();
  const [days, setDays] = useState(7);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStats = async (nextDays = days) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('dashboard/worker-stats', {
        params: { days: nextDays },
      });
      setItems(response.data.items || []);
    } catch (err) {
      setError(err?.response?.data?.msg || '載入工時統計失敗。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [days]);

  return (
    <div className="page">
      <AppHeader title="工時效率統計" subtitle="追蹤近期待辦與工時表現" />
      {error ? <div className="error-text">{error}</div> : null}
      <section className="panel">
        <div className="panel-header">
          <h2>統計區間</h2>
          <div className="task-toolbar">
            <label>
              區間
              <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                <option value={7}>近 7 天</option>
                <option value={30}>近 30 天</option>
                <option value={60}>近 60 天</option>
              </select>
            </label>
            <button type="button" className="secondary-button" onClick={() => loadStats(days)}>
              重新整理
            </button>
          </div>
        </div>
        {loading ? (
          <p>載入中...</p>
        ) : items.length === 0 ? (
          <p>目前沒有統計資料。</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人員</th>
                  <th>角色</th>
                  <th>完成件數</th>
                  <th>工時</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.user_id}>
                    <td>{item.username}</td>
                    <td>{labels[item.role] || item.role}</td>
                    <td>{item.completed_count}</td>
                    <td>{item.total_hours.toFixed(2)} 小時</td>
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

export default StatsPage;
