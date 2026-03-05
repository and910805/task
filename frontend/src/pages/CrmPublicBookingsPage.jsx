import { Fragment, useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const CrmPublicBookingsPage = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [convertingId, setConvertingId] = useState(null);
  const [expandedRows, setExpandedRows] = useState(() => new Set());

  const loadRows = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search.trim()) params.q = search.trim();
      if (status) params.status = status;
      const { data } = await api.get('crm/public-bookings', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '網站預約清單載入失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const pendingCount = useMemo(
    () => rows.filter((item) => String(item.status || '') === 'pending').length,
    [rows],
  );

  const handleConvert = async (id) => {
    setConvertingId(id);
    setError('');
    try {
      await api.post(`crm/public-bookings/${id}/convert`);
      await loadRows();
    } catch (err) {
      setError(err?.response?.data?.msg || '轉換失敗');
    } finally {
      setConvertingId(null);
    }
  };

  const toggleHiddenMeta = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="page">
      <AppHeader
        title="網站預約清單"
        subtitle={`管理官網預約表單，待轉換 ${pendingCount} 筆`}
        actions={(
          <button type="button" className="refresh-btn" onClick={loadRows} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>預約列表</h2>
          <div className="crm-search" style={{ display: 'flex', gap: 8 }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="姓名 / 電話 / 服務項目"
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部狀態</option>
              <option value="pending">待轉換</option>
              <option value="converted">已轉換</option>
            </select>
            <button type="button" className="secondary-btn" onClick={loadRows} disabled={loading}>
              查詢
            </button>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>建立時間</th>
                <th>姓名 / 聯絡</th>
                <th>服務需求</th>
                <th>備註</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>
                      <div>{row.name || '-'}</div>
                      <div>{row.phone || '-'}</div>
                      <div>{row.email || '-'}</div>
                    </td>
                    <td>
                      <div>{row.service || '-'}</div>
                      <div>{row.address || '-'}</div>
                    </td>
                    <td>{row.message || '-'}</td>
                    <td>
                      {row.status === 'converted' ? (
                        <span>已轉換（客戶 #{row.converted_customer_id || '-'}）</span>
                      ) : (
                        <span>待轉換</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {row.status === 'converted' ? (
                          <button type="button" className="secondary-btn" disabled>
                            已完成
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleConvert(row.id)}
                            disabled={convertingId === row.id}
                          >
                            {convertingId === row.id ? '轉換中...' : '轉成客戶'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => toggleHiddenMeta(row.id)}
                        >
                          {expandedRows.has(row.id) ? '隱藏資訊 ▲' : '隱藏資訊 ▼'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedRows.has(row.id) ? (
                    <tr>
                      <td colSpan="6" style={{ background: '#f8fafc' }}>
                        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
                          <div><b>Source URL:</b> {row.source_url || '-'}</div>
                          <div><b>Client IP:</b> {row.client_ip || '-'}</div>
                          <div><b>User Agent:</b> {row.user_agent || '-'}</div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan="6">目前沒有符合條件的預約資料</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="6">載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmPublicBookingsPage;
