import { Fragment, useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'pending', label: '待處理' },
  { value: 'contacted', label: '已接洽' },
  { value: 'quoted', label: '已報價' },
  { value: 'converted', label: '已轉客戶' },
  { value: 'closed', label: '已結案' },
];

const TYPE_OPTIONS = [
  { value: '', label: '全部類型' },
  { value: 'booking', label: '預約' },
  { value: 'quote', label: '詢價' },
  { value: 'contact', label: '聯絡' },
];

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

const inquiryTypeLabel = (value) =>
  ({
    booking: '預約',
    quote: '詢價',
    contact: '聯絡',
  }[String(value || '').trim()] || value || '-');

const statusLabel = (value) =>
  ({
    pending: '待處理',
    contacted: '已接洽',
    quoted: '已報價',
    converted: '已轉客戶',
    closed: '已結案',
  }[String(value || '').trim()] || value || '-');

const CrmPublicBookingsPage = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [inquiryType, setInquiryType] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});

  const loadRows = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search.trim()) params.q = search.trim();
      if (status) params.status = status;
      if (inquiryType) params.inquiry_type = inquiryType;
      const { data } = await api.get('crm/public-bookings', { params });
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      setDrafts(
        list.reduce((acc, row) => {
          acc[row.id] = {
            status: row.status || 'pending',
            follow_up_note: row.follow_up_note || '',
          };
          return acc;
        }, {}),
      );
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '網站名單載入失敗');
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

  const handleDraftChange = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        status: prev[id]?.status || 'pending',
        follow_up_note: prev[id]?.follow_up_note || '',
        [field]: value,
      },
    }));
  };

  const handleSave = async (id) => {
    setSavingId(id);
    setError('');
    try {
      await api.put(`crm/public-bookings/${id}`, drafts[id] || {});
      await loadRows();
    } catch (err) {
      setError(err?.response?.data?.msg || '更新網站名單失敗');
    } finally {
      setSavingId(null);
    }
  };

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

  const toggleExpanded = (id) => {
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
        title="網站來單中心"
        subtitle={`整合網站預約、詢價、聯絡名單，目前待處理 ${pendingCount} 筆`}
        actions={(
          <button type="button" className="refresh-btn" onClick={loadRows} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>網站名單</h2>
          <div className="crm-search" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="姓名 / 電話 / 地址 / 服務項目"
            />
            <select value={inquiryType} onChange={(event) => setInquiryType(event.target.value)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all-type'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all-status'} value={option.value}>
                  {option.label}
                </option>
              ))}
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
                <th>類型 / 需求</th>
                <th>客戶資料</th>
                <th>流程</th>
                <th>跟進備註</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.id] || { status: row.status || 'pending', follow_up_note: row.follow_up_note || '' };
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <div>{formatDateTime(row.created_at)}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{row.source_channel || 'website'}</div>
                      </td>
                      <td>
                        <div>{inquiryTypeLabel(row.inquiry_type)}</div>
                        <div>{row.service || '-'}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{row.preferred_time || '未指定聯絡時段'}</div>
                      </td>
                      <td>
                        <div>{row.name || '-'}</div>
                        <div>{row.phone || '-'}</div>
                        <div>{row.email || '-'}</div>
                        <div>{row.address || '-'}</div>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <select
                          value={draft.status}
                          onChange={(event) => handleDraftChange(row.id, 'status', event.target.value)}
                        >
                          {STATUS_OPTIONS.filter((item) => item.value).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
                          目前：{statusLabel(row.status)}
                        </div>
                        {row.converted_customer_id ? (
                          <div style={{ color: '#0f766e', fontSize: 12, marginTop: 4 }}>
                            客戶 #{row.converted_customer_id}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ minWidth: 240 }}>
                        <textarea
                          value={draft.follow_up_note}
                          onChange={(event) => handleDraftChange(row.id, 'follow_up_note', event.target.value)}
                          placeholder="記錄已聯絡、報價內容、下次跟進..."
                          style={{ minHeight: 84 }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleSave(row.id)}
                            disabled={savingId === row.id}
                          >
                            {savingId === row.id ? '儲存中...' : '儲存'}
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => handleConvert(row.id)}
                            disabled={convertingId === row.id || row.status === 'converted'}
                          >
                            {convertingId === row.id ? '轉換中...' : row.status === 'converted' ? '已轉換' : '轉成客戶'}
                          </button>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => toggleExpanded(row.id)}
                          >
                            {expandedRows.has(row.id) ? '隱藏資訊 ▲' : '詳細資訊 ▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedRows.has(row.id) ? (
                      <tr>
                        <td colSpan="6" style={{ background: '#f8fafc' }}>
                          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
                            <div><b>需求說明：</b> {row.message || '-'}</div>
                            <div><b>預算區間：</b> {row.budget_range || '-'}</div>
                            <div><b>來源網址：</b> {row.source_url || '-'}</div>
                            <div><b>IP：</b> {row.client_ip || '-'}</div>
                            <div><b>User Agent：</b> {row.user_agent || '-'}</div>
                            <div><b>最後接洽：</b> {formatDateTime(row.last_contacted_at)}</div>
                            <div><b>轉換時間：</b> {formatDateTime(row.converted_at)}</div>
                            <div><b>結案時間：</b> {formatDateTime(row.closed_at)}</div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}

              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan="6">目前沒有符合條件的網站名單</td>
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
