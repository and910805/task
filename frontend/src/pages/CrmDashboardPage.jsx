import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const formatAmount = (value) =>
  Number(value || 0).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });

const CrmDashboardPage = () => {
  const { user } = useAuth();
  const isManager = managerRoles.has(user?.role);
  const [data, setData] = useState({ customers: [], contacts: [], quotes: [] });
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
    return [
      { label: '客戶數', value: data.customers.length, hint: '建立中的客戶資料' },
      { label: '聯絡人數', value: data.contacts.length, hint: '客戶窗口資料' },
      { label: '報價總額', value: formatAmount(quoteTotal), hint: `${data.quotes.length} 筆報價單` },
      { label: '報價單數', value: data.quotes.length, hint: '含草稿與已建立報價' },
    ];
  }, [data]);

  const baseModuleCards = useMemo(
    () => [
      { title: '客戶管理', desc: '維護客戶主檔與基本聯絡資訊。', to: '/crm/customers', tag: 'Master Data' },
      { title: '聯絡人管理', desc: '管理客戶聯絡窗口與聯繫方式。', to: '/crm/contacts', tag: 'Master Data' },
      { title: '價目資料庫', desc: '維護常用服務品項、單位與預設價格。', to: '/crm/catalog', tag: 'Pricing' },
      { title: '報價與請款', desc: '建立報價單、轉請款單並下載 PDF。', to: '/crm/quotes', tag: 'Sales' },
      { title: '考勤管理', desc: '查看人員出勤與現場打卡記錄。', to: '/attendance', tag: 'Field Ops' },
      { title: '報表中心', desc: '檢視營運數據與任務統計報表。', to: '/reports', tag: 'Analytics' },
    ],
    [],
  );

  const moduleCards = useMemo(() => {
    if (!isManager) return baseModuleCards;
    return [
      ...baseModuleCards.slice(0, 4),
      {
        title: '耗材入庫',
        desc: '建立耗材主檔、記錄進貨與入庫成本。',
        to: '/materials/purchases',
        tag: 'Materials',
      },
      {
        title: '耗材月結',
        desc: '查看每月進貨、耗用、庫存與異動帳。',
        to: '/materials/reports',
        tag: 'Materials',
      },
      ...baseModuleCards.slice(4),
    ];
  }, [baseModuleCards, isManager]);

  return (
    <div className="page">
      <AppHeader
        title="經營管理"
        subtitle="整合客戶、報價、請款、耗材與營運報表入口"
        actions={(
          <button type="button" className="refresh-btn" onClick={loadData} disabled={loading}>
            重新整理
          </button>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}

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
          <h2>功能入口</h2>
          <span className="panel-tag">Professional Suite</span>
        </div>
        <div className="crm-hub-grid">
          {moduleCards.map((card) => (
            <Link key={card.to} className="crm-module-card" to={card.to}>
              <span className="crm-module-card__tag">{card.tag}</span>
              <h3>{card.title}</h3>
              <p>{card.desc}</p>
              <span className="crm-module-card__cta">前往功能</span>
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
                <th>單號</th>
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
              {!loading && data.quotes.length === 0 ? (
                <tr>
                  <td colSpan="3">尚無報價單</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmDashboardPage;
