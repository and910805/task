import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const toCurrency = (value) =>
  Number(value || 0).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });

const toDateValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const ReportsPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    status: 'all',
  });

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRes, contactRes, quoteRes] = await Promise.all([
        api.get('crm/customers'),
        api.get('crm/contacts'),
        api.get('crm/quotes'),
      ]);
      setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
      setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
      setQuotes(Array.isArray(quoteRes.data) ? quoteRes.data : []);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '報表資料載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const statusOptions = useMemo(() => {
    const set = new Set(['all']);
    for (const row of quotes) set.add(row.status || 'draft');
    return Array.from(set);
  }, [quotes]);

  const reportRows = useMemo(() => {
    return quotes.map((row) => ({
      doc_type: 'quote',
      no: row.quote_no || '',
      status: row.status || '',
      amount: Number(row.total_amount || 0),
      date: toDateValue(row.issue_date || row.created_at),
      raw: row,
    })
      .filter((row) => {
        if (filters.status !== 'all' && row.status !== filters.status) return false;
        if (filters.date_from && row.date && row.date < filters.date_from) return false;
        if (filters.date_to && row.date && row.date > filters.date_to) return false;
        return true;
      })
      .sort((a, b) => `${b.date}${b.no}`.localeCompare(`${a.date}${a.no}`));
  }, [quotes, filters]);

  const stats = useMemo(() => {
    const quoteRows = reportRows;
    const quoteTotal = quoteRows.reduce((sum, row) => sum + row.amount, 0);

    return {
      customerCount: customers.length,
      contactCount: contacts.length,
      quoteCount: quoteRows.length,
      quoteTotal,
    };
  }, [reportRows, customers.length, contacts.length]);

  const handleExportTasks = async () => {
    setExporting(true);
    setError('');
    setExportResult(null);
    try {
      const { data } = await api.get('export/tasks');
      const rawUrl = data?.url || '';
      const base = (api.defaults.baseURL || '').replace(/\/$/, '');
      const downloadUrl = rawUrl.startsWith('http') ? rawUrl : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      setExportResult({
        filename: data?.filename || 'task_report.xlsx',
        url: downloadUrl,
      });
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '匯出任務報表失敗';
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = () => {
    const header = ['單號', '狀態', '日期', '金額'];
    const body = reportRows.map((row) => [
      row.no,
      row.status,
      row.date,
      row.amount.toFixed(2),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map(csvEscape).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `taskgo_report_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <AppHeader
        title="報表中心"
        subtitle="估價單、出勤與任務資料的報表中心"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadAll} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error && <p className="error-text">{error}</p>}

      <section className="panel panel--metrics">
        <div className="metric-grid">
          <div className="metric-card">
            <p className="metric-label">客戶數</p>
            <h3>{stats.customerCount}</h3>
          </div>
          <div className="metric-card">
            <p className="metric-label">聯絡人數</p>
            <h3>{stats.contactCount}</h3>
          </div>
          <div className="metric-card">
            <p className="metric-label">報價單數</p>
            <h3>{stats.quoteCount}</h3>
          </div>
        </div>
      </section>

      <section className="panel report-summary-grid">
        <article className="report-summary-card">
          <p className="metric-label">報價總額</p>
          <h3>{toCurrency(stats.quoteTotal)}</h3>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>篩選條件</h2>
        </div>
        <div className="attendance-filter-grid">
          <label>
            狀態
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
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
        </div>
        <div className="report-actions">
          <button type="button" className="secondary-btn" onClick={exportCsv}>
            匯出 CSV
          </button>
          <button type="button" className="secondary-btn" onClick={() => window.print()}>
            匯出 PDF（列印）
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>任務報表匯出</h2>
        </div>
        <p className="panel-hint">
          匯出內容包含任務主檔、附件清單與工時紀錄，適合內部彙整或稽核。
        </p>
        <div className="report-actions">
          <button type="button" onClick={handleExportTasks} disabled={exporting}>
            {exporting ? '匯出中...' : '匯出任務報表 (Excel)'}
          </button>
          {exportResult ? (
            <a className="crm-action" href={exportResult.url} target="_blank" rel="noreferrer">
              下載 {exportResult.filename}
            </a>
          ) : null}
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>文件明細</h2>
          <span className="panel-tag">{reportRows.length} 筆</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>單號</th>
                <th>狀態</th>
                <th>日期</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row) => (
                <tr key={`${row.no}-${row.date}`}>
                  <td>{row.no}</td>
                  <td>{row.status}</td>
                  <td>{row.date || '-'}</td>
                  <td>{row.amount.toFixed(2)}</td>
                </tr>
              ))}
              {!loading && reportRows.length === 0 ? (
                <tr>
                  <td colSpan="4">目前無符合條件資料</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel crm-actions">
        <h2>關聯模組</h2>
        <div className="crm-action-grid">
          <Link className="crm-action" to="/crm/quotes">查看報價單</Link>
          <Link className="crm-action" to="/attendance">查看出勤</Link>
          <Link className="crm-action" to="/crm/customers">查看客戶</Link>
        </div>
      </section>
    </div>
  );
};

export default ReportsPage;
