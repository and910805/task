import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const toCurrency = (value) =>
  Number(value || 0).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });

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

const auditActionLabel = (action) => {
  const map = {
    catalog_item_create: '新增價目',
    catalog_item_update: '更新價目',
    catalog_item_toggle: '切換價目啟用',
    catalog_item_delete: '刪除價目',
    invoice_create_from_quote: '報價轉請款',
    invoice_update: '更新請款單',
    invoice_status_update: '更新請款狀態',
    invoice_cancel: '取消請款單',
    invoice_payment_create: '新增收款',
    invoice_payment_delete: '刪除收款',
    website_lead_update: '更新網站名單',
    website_lead_convert: '網站名單轉客戶',
  };
  return map[String(action || '').trim()] || action || '-';
};

const inquiryTypeLabel = (value) =>
  ({
    booking: '預約',
    quote: '詢價',
    contact: '聯絡',
  }[String(value || '').trim()] || value || '-');

const summaryCardItems = (boot, leadSummary) => [
  {
    label: '網站名單',
    value: leadSummary.total_leads || 0,
    hint: `近 30 天 ${leadSummary.recent_30d_leads || 0} 筆`,
  },
  {
    label: '待跟進',
    value: leadSummary.pending_leads || 0,
    hint: `已接洽 ${leadSummary.contacted_leads || 0} 筆`,
  },
  {
    label: '報價單',
    value: leadSummary.quote_count || boot.quotes.length || 0,
    hint: toCurrency(leadSummary.quote_total || 0),
  },
  {
    label: '已收款營業額',
    value: toCurrency(leadSummary.paid_total || 0),
    hint: `轉換率 ${Number(leadSummary.conversion_rate || 0).toFixed(1)}%`,
  },
];

const CrmDashboardPage = () => {
  const { user } = useAuth();
  const isManager = managerRoles.has(user?.role);
  const [boot, setBoot] = useState({ customers: [], contacts: [], quotes: [] });
  const [leadMetrics, setLeadMetrics] = useState({ summary: {}, by_type: [], by_status: [], monthly: [] });
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [api.get('crm/boot'), api.get('crm/lead-metrics')];
      if (isManager) {
        requests.push(api.get('crm/audit-logs', { params: { module: 'crm', limit: 20 } }));
      }
      const [bootResp, leadResp, auditResp] = await Promise.all(requests);
      const payload = bootResp?.data || {};
      setBoot({
        customers: Array.isArray(payload.customers) ? payload.customers : [],
        contacts: Array.isArray(payload.contacts) ? payload.contacts : [],
        quotes: Array.isArray(payload.quotes) ? payload.quotes : [],
      });
      setLeadMetrics(leadResp?.data || { summary: {}, by_type: [], by_status: [], monthly: [] });
      setAuditLogs(Array.isArray(auditResp?.data) ? auditResp.data : []);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || 'CRM 資料載入失敗');
      setAuditLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isManager]);

  const summary = leadMetrics?.summary || {};
  const cards = useMemo(() => summaryCardItems(boot, summary), [boot, summary]);
  const recentQuotes = useMemo(() => boot.quotes.slice(0, 5), [boot.quotes]);
  const leadTypeRows = Array.isArray(leadMetrics?.by_type) ? leadMetrics.by_type : [];
  const leadStatusRows = Array.isArray(leadMetrics?.by_status) ? leadMetrics.by_status : [];
  const monthlyRows = Array.isArray(leadMetrics?.monthly) ? leadMetrics.monthly.slice(-6) : [];

  return (
    <div className="page">
      <AppHeader
        title="CRM 儀表板"
        subtitle="把網站詢價、預約、聯絡一路追到報價與營收。"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadData} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel panel--metrics">
        <div className="metric-grid">
          {cards.map((item) => (
            <article key={item.label} className="metric-card">
              <p className="metric-card__title">{item.label}</p>
              <p className="metric-card__value">{item.value}</p>
              <p className="metric-card__hint">{item.hint}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>網站轉單漏斗</h2>
          <Link to="/crm/bookings">查看全部名單</Link>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>名單來源</th>
                <th>數量</th>
                <th>流程狀態</th>
                <th>數量</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(leadTypeRows.length, leadStatusRows.length, 1) }).map((_, index) => (
                <tr key={`funnel-${index}`}>
                  <td>{leadTypeRows[index] ? inquiryTypeLabel(leadTypeRows[index].type) : '-'}</td>
                  <td>{leadTypeRows[index]?.count ?? '-'}</td>
                  <td>{leadStatusRows[index]?.status ?? '-'}</td>
                  <td>{leadStatusRows[index]?.count ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>近六個月成效</h2>
          <span className="panel-tag">Leads / Revenue</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>月份</th>
                <th>網站名單</th>
                <th>已轉客戶</th>
                <th>報價單</th>
                <th>請款金額</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{row.leads}</td>
                  <td>{row.converted}</td>
                  <td>{row.quotes}</td>
                  <td>{toCurrency(row.invoice_total || 0)}</td>
                </tr>
              ))}
              {!loading && monthlyRows.length === 0 ? (
                <tr>
                  <td colSpan="5">目前沒有可顯示的網站成效資料</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>最近報價</h2>
          <Link to="/crm/quotes">前往報價單</Link>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>報價單號</th>
                <th>狀態</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {recentQuotes.map((quote) => (
                <tr key={quote.id}>
                  <td>{quote.quote_no || '-'}</td>
                  <td>{quote.status || '-'}</td>
                  <td>{toCurrency(quote.total_amount || 0)}</td>
                </tr>
              ))}
              {!loading && recentQuotes.length === 0 ? (
                <tr>
                  <td colSpan="3">目前沒有報價資料</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {isManager ? (
        <section className="panel panel--table">
          <div className="panel-header">
            <h2>最近 CRM 異動</h2>
            <span className="panel-tag">Audit</span>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>操作者</th>
                  <th>動作</th>
                  <th>對象</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((row) => (
                  <tr key={`${row.id}-${row.created_at || ''}`}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.actor_username || '-'}</td>
                    <td>{auditActionLabel(row.action)}</td>
                    <td>{row.entity_label || row.entity_type || '-'}</td>
                    <td>{row.note || '-'}</td>
                  </tr>
                ))}
                {!loading && auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5">目前沒有 CRM 操作紀錄</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default CrmDashboardPage;
