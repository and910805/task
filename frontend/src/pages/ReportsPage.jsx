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

const currentMonthInput = () => new Date().toISOString().slice(0, 7);
const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const normalizeText = (value) => String(value || '').toLowerCase().trim();

const parseAmount = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isNaN(amount) ? null : amount;
};

const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

const ReportsPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [materialsMonth, setMaterialsMonth] = useState(() => currentMonthInput());
  const [materialsReport, setMaterialsReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    keyword: '',
    customer_id: '',
    date_from: '',
    date_to: '',
    status: 'all',
    amount_min: '',
    amount_max: '',
  });
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [focusCustomerId, setFocusCustomerId] = useState('');

  const loadAll = async (targetMonth = materialsMonth) => {
    setLoading(true);
    setError('');
    try {
      const [customerRes, contactRes, quoteRes, invoiceRes, materialsRes] = await Promise.all([
        api.get('crm/customers'),
        api.get('crm/contacts'),
        api.get('crm/quotes'),
        api.get('crm/invoices'),
        api.get('materials/reports/monthly', { params: { month: targetMonth } }),
      ]);
      setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
      setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
      setQuotes(Array.isArray(quoteRes.data) ? quoteRes.data : []);
      setInvoices(Array.isArray(invoiceRes.data) ? invoiceRes.data : []);
      setMaterialsReport(materialsRes.data || null);
    } catch (err) {
      setError(getErrorMessage(err, '載入報表資料失敗'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll(materialsMonth);
  }, [materialsMonth]);

  const statusOptions = useMemo(() => {
    const set = new Set(['all']);
    for (const row of quotes) set.add(row.status || 'draft');
    return Array.from(set);
  }, [quotes]);

  const customerMap = useMemo(
    () => new Map(customers.map((row) => [String(row.id), row])),
    [customers],
  );

  const baseQuoteRows = useMemo(() => {
    return quotes.map((row) => {
      const customer = customerMap.get(String(row.customer_id));
      const customerName = row.customer_name || customer?.name || '';
      const recipientName = row.recipient_name || row.contact_name || customerName;
      const firstItem = row.items?.[0]?.description || '';
      return {
        doc_type: 'quote',
        no: row.quote_no || '',
        customer_id: String(row.customer_id || ''),
        customer_name: customerName,
        recipient_name: recipientName,
        first_item: firstItem,
        status: row.status || '',
        amount: Number(row.subtotal ?? row.total_amount ?? 0),
        date: toDateValue(row.issue_date || row.created_at),
        raw: row,
      };
    });
  }, [quotes, customerMap]);

  const reportRows = useMemo(() => {
    const keyword = normalizeText(filters.keyword);
    const amountMin = parseAmount(filters.amount_min);
    const amountMax = parseAmount(filters.amount_max);

    return baseQuoteRows
      .filter((row) => {
        if (filters.customer_id && String(row.customer_id) !== String(filters.customer_id)) return false;
        if (filters.status !== 'all' && row.status !== filters.status) return false;
        if (filters.date_from && row.date && row.date < filters.date_from) return false;
        if (filters.date_to && row.date && row.date > filters.date_to) return false;
        if (amountMin !== null && row.amount < amountMin) return false;
        if (amountMax !== null && row.amount > amountMax) return false;
        if (keyword) {
          const haystack = normalizeText([
            row.no,
            row.customer_name,
            row.recipient_name,
            row.first_item,
            row.status,
          ].join(' '));
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const factor = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'amount') return (a.amount - b.amount) * factor;
        if (sortBy === 'date') return String(a.date || '').localeCompare(String(b.date || '')) * factor;
        return String(a[sortBy] || '').localeCompare(String(b[sortBy] || '')) * factor;
      });
  }, [baseQuoteRows, filters, sortBy, sortDir]);

  const invoiceRows = useMemo(() => {
    return invoices.map((row) => ({
      id: row.id,
      customer_id: String(row.customer_id || ''),
      amount: Number(row.total_amount || 0),
      payment_total: Number(row.payment_total || 0),
      outstanding_amount: Number(row.outstanding_amount || 0),
      status: row.status || '',
      date: toDateValue(row.issue_date || row.created_at),
    }));
  }, [invoices]);

  const filteredInvoiceRows = useMemo(() => {
    const customerId = String(filters.customer_id || '');
    return invoiceRows.filter((row) => {
      if (customerId && row.customer_id !== customerId) return false;
      if (filters.date_from && row.date && row.date < filters.date_from) return false;
      if (filters.date_to && row.date && row.date > filters.date_to) return false;
      return true;
    });
  }, [invoiceRows, filters.customer_id, filters.date_from, filters.date_to]);

  const stats = useMemo(() => {
    const quoteTotal = reportRows.reduce((sum, row) => sum + row.amount, 0);
    const invoiceTotal = filteredInvoiceRows.reduce((sum, row) => sum + row.amount, 0);
    const receivedTotal = filteredInvoiceRows.reduce((sum, row) => sum + row.payment_total, 0);
    const outstandingTotal = filteredInvoiceRows.reduce((sum, row) => sum + row.outstanding_amount, 0);
    const materialSummary = materialsReport?.summary || {};

    return {
      customerCount: customers.length,
      contactCount: contacts.length,
      quoteCount: reportRows.length,
      invoiceCount: filteredInvoiceRows.length,
      quoteTotal,
      invoiceTotal,
      receivedTotal,
      outstandingTotal,
      materialUsageTotal: Number(materialSummary.usage_total_amount || 0),
      materialPurchaseTotal: Number(materialSummary.purchase_total_amount || 0),
    };
  }, [reportRows, filteredInvoiceRows, materialsReport, customers.length, contacts.length]);

  const focusedCustomer = useMemo(() => {
    if (!focusCustomerId) return null;
    return customerMap.get(String(focusCustomerId)) || null;
  }, [focusCustomerId, customerMap]);

  const focusedCustomerRows = useMemo(() => {
    if (!focusCustomerId) return [];
    return baseQuoteRows
      .filter((row) => String(row.customer_id) === String(focusCustomerId))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [baseQuoteRows, focusCustomerId]);

  const focusedCustomerInvoices = useMemo(() => {
    if (!focusCustomerId) return [];
    return invoiceRows.filter((row) => String(row.customer_id) === String(focusCustomerId));
  }, [invoiceRows, focusCustomerId]);

  const focusedCustomerStats = useMemo(() => {
    if (!focusCustomerId) return null;
    return {
      quoteCount: focusedCustomerRows.length,
      quoteTotal: focusedCustomerRows.reduce((sum, row) => sum + row.amount, 0),
      invoiceTotal: focusedCustomerInvoices.reduce((sum, row) => sum + row.amount, 0),
      receivedTotal: focusedCustomerInvoices.reduce((sum, row) => sum + row.payment_total, 0),
      latest: focusedCustomerRows[0]?.date || '-',
    };
  }, [focusedCustomerRows, focusedCustomerInvoices, focusCustomerId]);

  const onSort = (key) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  };

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
      setError(getErrorMessage(err, '匯出任務報表失敗'));
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = () => {
    const header = ['報價單號', '客戶', '聯絡人', '狀態', '日期', '第一項內容', '報價金額'];
    const body = reportRows.map((row) => [
      row.no,
      row.customer_name,
      row.recipient_name,
      row.status,
      row.date,
      row.first_item,
      row.amount.toFixed(2),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map(csvEscape).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reports_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <AppHeader
        title="報表中心"
        subtitle="估價、請款、收款與耗材成本的營運總覽"
        actions={(
          <button type="button" className="refresh-btn" onClick={() => loadAll(materialsMonth)} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}

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
            <p className="metric-label">請款單數</p>
            <h3>{stats.invoiceCount}</h3>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>營運摘要</h2>
          <label style={{ maxWidth: 220 }}>
            耗材月份
            <input type="month" value={materialsMonth} onChange={(event) => setMaterialsMonth(event.target.value)} />
          </label>
        </div>
        <div className="report-summary-grid">
          <article className="report-summary-card">
            <p className="metric-label">報價金額</p>
            <h3>{toCurrency(stats.quoteTotal)}</h3>
          </article>
          <article className="report-summary-card">
            <p className="metric-label">請款金額</p>
            <h3>{toCurrency(stats.invoiceTotal)}</h3>
          </article>
          <article className="report-summary-card">
            <p className="metric-label">實收金額</p>
            <h3>{toCurrency(stats.receivedTotal)}</h3>
          </article>
          <article className="report-summary-card">
            <p className="metric-label">未收金額</p>
            <h3>{toCurrency(stats.outstandingTotal)}</h3>
          </article>
          <article className="report-summary-card">
            <p className="metric-label">{materialsMonth} 耗材費</p>
            <h3>{toCurrency(stats.materialUsageTotal)}</h3>
          </article>
          <article className="report-summary-card">
            <p className="metric-label">{materialsMonth} 進貨金額</p>
            <h3>{toCurrency(stats.materialPurchaseTotal)}</h3>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>報價篩選</h2>
        </div>
        <div className="attendance-filter-grid">
          <label>
            關鍵字
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              placeholder="單號 / 客戶 / 聯絡人 / 項目"
            />
          </label>
          <label>
            客戶
            <select
              value={filters.customer_id}
              onChange={(event) => {
                const next = event.target.value;
                setFilters((prev) => ({ ...prev, customer_id: next }));
                setFocusCustomerId(next);
              }}
            >
              <option value="">全部客戶</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
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
            起始日期
            <input
              type="date"
              value={filters.date_from}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
            />
          </label>
          <label>
            結束日期
            <input
              type="date"
              value={filters.date_to}
              onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
            />
          </label>
          <label>
            最低金額
            <input
              type="number"
              value={filters.amount_min}
              onChange={(event) => setFilters((prev) => ({ ...prev, amount_min: event.target.value }))}
              placeholder="0"
            />
          </label>
          <label>
            最高金額
            <input
              type="number"
              value={filters.amount_max}
              onChange={(event) => setFilters((prev) => ({ ...prev, amount_max: event.target.value }))}
              placeholder="不限"
            />
          </label>
        </div>
        <div className="report-actions">
          <button type="button" className="secondary-btn" onClick={exportCsv}>
            匯出 CSV
          </button>
          <button type="button" className="secondary-btn" onClick={() => window.print()}>
            列印 PDF
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setFilters({
                keyword: '',
                customer_id: '',
                date_from: '',
                date_to: '',
                status: 'all',
                amount_min: '',
                amount_max: '',
              });
              setFocusCustomerId('');
              setSortBy('date');
              setSortDir('desc');
            }}
          >
            清除篩選
          </button>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>客戶摘要</h2>
          <span className="panel-tag">{focusedCustomerRows.length} 筆報價</span>
        </div>
        {focusCustomerId && focusedCustomer ? (
          <>
            <div className="report-summary-grid">
              <article className="report-summary-card">
                <p className="metric-label">客戶</p>
                <h3>{focusedCustomer.name}</h3>
              </article>
              <article className="report-summary-card">
                <p className="metric-label">報價筆數</p>
                <h3>{focusedCustomerStats?.quoteCount || 0}</h3>
              </article>
              <article className="report-summary-card">
                <p className="metric-label">報價金額</p>
                <h3>{toCurrency(focusedCustomerStats?.quoteTotal || 0)}</h3>
              </article>
              <article className="report-summary-card">
                <p className="metric-label">請款金額</p>
                <h3>{toCurrency(focusedCustomerStats?.invoiceTotal || 0)}</h3>
              </article>
              <article className="report-summary-card">
                <p className="metric-label">實收金額</p>
                <h3>{toCurrency(focusedCustomerStats?.receivedTotal || 0)}</h3>
              </article>
              <article className="report-summary-card">
                <p className="metric-label">最近報價日</p>
                <h3>{focusedCustomerStats?.latest || '-'}</h3>
              </article>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>報價單號</th>
                    <th>聯絡人</th>
                    <th>狀態</th>
                    <th>日期</th>
                    <th>第一項內容</th>
                    <th>報價金額</th>
                  </tr>
                </thead>
                <tbody>
                  {focusedCustomerRows.map((row) => (
                    <tr key={`focused-${row.no}-${row.date}`}>
                      <td>{row.no}</td>
                      <td>{row.recipient_name || '-'}</td>
                      <td>{row.status || '-'}</td>
                      <td>{row.date || '-'}</td>
                      <td>{row.first_item || '-'}</td>
                      <td>{toCurrency(row.amount)}</td>
                    </tr>
                  ))}
                  {focusedCustomerRows.length === 0 ? (
                    <tr>
                      <td colSpan="6">這位客戶目前沒有報價資料。</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="panel-hint">從上方篩選或下方表格選一位客戶，即可查看該客戶的報價、請款與實收摘要。</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>任務報表匯出</h2>
        </div>
        <p className="panel-hint">可匯出任務 Excel，包含任務基本資料、附件與工時明細。</p>
        <div className="report-actions">
          <button type="button" onClick={handleExportTasks} disabled={exporting}>
            {exporting ? '匯出中...' : '匯出任務報表（Excel）'}
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
          <h2>報價明細</h2>
          <span className="panel-tag">{reportRows.length} 筆</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th className="report-sortable-th" onClick={() => onSort('no')}>報價單號</th>
                <th className="report-sortable-th" onClick={() => onSort('customer_name')}>客戶</th>
                <th className="report-sortable-th" onClick={() => onSort('recipient_name')}>聯絡人</th>
                <th className="report-sortable-th" onClick={() => onSort('status')}>狀態</th>
                <th className="report-sortable-th" onClick={() => onSort('date')}>日期</th>
                <th>第一項內容</th>
                <th className="report-sortable-th" onClick={() => onSort('amount')}>報價金額</th>
                <th>客戶摘要</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row) => (
                <tr key={`${row.no}-${row.date}`}>
                  <td>{row.no}</td>
                  <td>{row.customer_name || '-'}</td>
                  <td>{row.recipient_name || '-'}</td>
                  <td>{row.status || '-'}</td>
                  <td>{row.date || '-'}</td>
                  <td>{row.first_item || '-'}</td>
                  <td>{toCurrency(row.amount)}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setFocusCustomerId(String(row.customer_id || ''))}
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && reportRows.length === 0 ? (
                <tr>
                  <td colSpan="8">目前沒有符合條件的報價資料。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel crm-actions">
        <h2>快速入口</h2>
        <div className="crm-action-grid">
          <Link className="crm-action" to="/crm/quotes">前往報價單</Link>
          <Link className="crm-action" to="/attendance">前往出勤</Link>
          <Link className="crm-action" to="/crm/customers">前往客戶管理</Link>
          <Link className="crm-action" to="/materials/reports">前往耗材月結</Link>
        </div>
      </section>
    </div>
  );
};

export default ReportsPage;
