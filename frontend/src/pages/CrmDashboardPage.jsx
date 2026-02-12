import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const formatAmount = (value) =>
  Number(value || 0).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });

const CrmDashboardPage = () => {
  const [data, setData] = useState({ customers: [], contacts: [], quotes: [], invoices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: payload } = await api.get('crm/boot');
      setData({
        customers: payload?.customers ?? [],
        contacts: payload?.contacts ?? [],
        quotes: payload?.quotes ?? [],
        invoices: payload?.invoices ?? [],
      });
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || 'CRM 資料載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const metrics = useMemo(() => {
    const quoteTotal = data.quotes.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const invoiceTotal = data.invoices.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const unpaidTotal = data.invoices
      .filter((item) => !['paid', 'cancelled'].includes((item.status || '').toLowerCase()))
      .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

    return [
      { label: '客戶資料', value: data.customers.length, hint: '主檔維護' },
      { label: '聯絡人資料', value: data.contacts.length, hint: '關鍵窗口' },
      { label: '報價總額', value: formatAmount(quoteTotal), hint: `${data.quotes.length} 筆報價` },
      { label: '未收金額', value: formatAmount(unpaidTotal), hint: `發票總額 ${formatAmount(invoiceTotal)}` },
    ];
  }, [data]);

  const moduleCards = [
    { title: '客戶管理', desc: '維護客戶主資料、統編與聯絡資訊。', to: '/crm/customers', tag: 'Master Data' },
    { title: '聯絡人管理', desc: '建立客戶聯絡人與主要窗口。', to: '/crm/contacts', tag: 'Master Data' },
    { title: '報價單系統', desc: '可客製品項、稅率、備註並輸出 PDF。', to: '/crm/quotes', tag: 'Sales' },
    { title: '發票系統', desc: '建立請款發票，管理開立與收款狀態。', to: '/crm/invoices', tag: 'Billing' },
    { title: '出勤中心', desc: '彙整人員工時與任務出勤紀錄。', to: '/attendance', tag: 'Field Ops' },
    { title: '報表中心', desc: '業務指標檢視與任務報表匯出。', to: '/reports', tag: 'Analytics' },
  ];

  return (
    <div className="page">
      <AppHeader
        title="營運中台"
        subtitle="客戶、報價、發票、出勤與報表的系統化整合平台"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadData} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error && <p className="error-text">{error}</p>}

      <section className="panel panel--metrics">
        <div className="metric-grid">
          {metrics.map((item) => (
            <article key={item.label} className="metric-card">
              <p className="metric-card__title">{item.label}</p>
              <p className="metric-card__value">{item.value}</p>
              <p className="metric-card__hint">{item.hint}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>系統模組</h2>
          <span className="panel-tag">Professional Suite</span>
        </div>
        <div className="crm-hub-grid">
          {moduleCards.map((card) => (
            <Link key={card.to} className="crm-module-card" to={card.to}>
              <span className="crm-module-card__tag">{card.tag}</span>
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
              <span className="crm-module-card__cta">進入模組</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>最近報價單</h2>
          <Link to="/crm/quotes">查看全部</Link>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>狀態</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {data.quotes.slice(0, 5).map((quote) => (
                <tr key={quote.id}>
                  <td>{quote.quote_no}</td>
                  <td>{quote.status}</td>
                  <td>{Number(quote.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && data.quotes.length === 0 && (
                <tr>
                  <td colSpan="3">尚無報價單</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>最近發票</h2>
          <Link to="/crm/invoices">查看全部</Link>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>狀態</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.slice(0, 5).map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_no}</td>
                  <td>{invoice.status}</td>
                  <td>{Number(invoice.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && data.invoices.length === 0 && (
                <tr>
                  <td colSpan="3">尚無發票</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmDashboardPage;
