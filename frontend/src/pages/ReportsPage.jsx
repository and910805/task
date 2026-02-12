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

const ReportsPage = () => {
  const [bootData, setBootData] = useState({
    quotes: [],
    invoices: [],
    customers: [],
    contacts: [],
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [error, setError] = useState('');

  const loadBoot = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('crm/boot');
      setBootData({
        quotes: Array.isArray(data?.quotes) ? data.quotes : [],
        invoices: Array.isArray(data?.invoices) ? data.invoices : [],
        customers: Array.isArray(data?.customers) ? data.customers : [],
        contacts: Array.isArray(data?.contacts) ? data.contacts : [],
      });
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '報表資料載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoot();
  }, []);

  const stats = useMemo(() => {
    const quoteTotal = bootData.quotes.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const invoiceTotal = bootData.invoices.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const unpaidTotal = bootData.invoices
      .filter((row) => !['paid', 'cancelled'].includes((row.status || '').toLowerCase()))
      .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);

    return {
      quoteCount: bootData.quotes.length,
      invoiceCount: bootData.invoices.length,
      customerCount: bootData.customers.length,
      contactCount: bootData.contacts.length,
      quoteTotal,
      invoiceTotal,
      unpaidTotal,
    };
  }, [bootData]);

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
      const message = err?.networkMessage || err?.response?.data?.msg || '匯出報表失敗';
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <AppHeader
        title="報表中心"
        subtitle="業務數據、任務報表與文件輸出整合管理"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadBoot} disabled={loading}>
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
          <div className="metric-card">
            <p className="metric-label">發票數</p>
            <h3>{stats.invoiceCount}</h3>
          </div>
        </div>
      </section>

      <section className="panel report-summary-grid">
        <article className="report-summary-card">
          <p className="metric-label">報價總額</p>
          <h3>{toCurrency(stats.quoteTotal)}</h3>
        </article>
        <article className="report-summary-card">
          <p className="metric-label">發票總額</p>
          <h3>{toCurrency(stats.invoiceTotal)}</h3>
        </article>
        <article className="report-summary-card">
          <p className="metric-label">未收金額</p>
          <h3>{toCurrency(stats.unpaidTotal)}</h3>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>任務報表匯出</h2>
        </div>
        <p className="panel-hint">
          匯出內容包含任務主檔、附件清單與工時紀錄，適合交付內部彙整或財務報帳使用。
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

      <section className="panel crm-actions">
        <h2>關聯模組</h2>
        <div className="crm-action-grid">
          <Link className="crm-action" to="/crm/quotes">查看報價單</Link>
          <Link className="crm-action" to="/crm/invoices">查看發票</Link>
          <Link className="crm-action" to="/attendance">查看出勤</Link>
          <Link className="crm-action" to="/crm/customers">查看客戶</Link>
        </div>
      </section>
    </div>
  );
};

export default ReportsPage;
