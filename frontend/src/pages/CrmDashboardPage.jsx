import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

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

  const metrics = useMemo(
    () => [
      { label: '客戶', value: data.customers.length },
      { label: '聯絡人', value: data.contacts.length },
      { label: '報價單', value: data.quotes.length },
      { label: '發票', value: data.invoices.length },
    ],
    [data],
  );

  return (
    <div className="page">
      <AppHeader
        title="紅包活動 CRM"
        subtitle="客戶、聯絡人、報價與發票管理"
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
            <div key={item.label} className="metric-card">
              <p className="metric-label">{item.label}</p>
              <h3>{item.value}</h3>
            </div>
          ))}
        </div>
      </section>

      <section className="panel crm-actions">
        <h2>快速前往</h2>
        <div className="crm-action-grid">
          <Link className="crm-action" to="/crm/customers">客戶管理</Link>
          <Link className="crm-action" to="/crm/contacts">聯絡人</Link>
          <Link className="crm-action" to="/crm/quotes">報價單</Link>
          <Link className="crm-action" to="/crm/invoices">發票</Link>
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
                  <td>{quote.total_amount?.toFixed(2)}</td>
                </tr>
              ))}
              {data.quotes.length === 0 && (
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
                  <td>{invoice.total_amount?.toFixed(2)}</td>
                </tr>
              ))}
              {data.invoices.length === 0 && (
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
