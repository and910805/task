import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';

const shortcutItems = [
  { id: 'shortcut-crm', type: '捷徑', title: '經營管理', subtitle: 'CRM 系統首頁', href: '/crm' },
  { id: 'shortcut-attendance', type: '捷徑', title: '出勤中心', subtitle: '工時與異常檢視', href: '/attendance' },
  { id: 'shortcut-reports', type: '捷徑', title: '報表中心', subtitle: '匯出與營運指標', href: '/reports' },
];

const GlobalSearch = () => {
  const [query, setQuery] = useState('');
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  const buildItems = (tasks = [], boot = {}) => {
    const taskItems = (Array.isArray(tasks) ? tasks : []).map((task) => ({
      id: `task-${task.id}`,
      type: '任務',
      title: task.title || '未命名任務',
      subtitle: `${task.status || '未設定'} · ${task.location || '未設定地點'}`,
      href: `/tasks/${task.id}`,
    }));
    const customerItems = (Array.isArray(boot.customers) ? boot.customers : []).map((customer) => ({
      id: `customer-${customer.id}`,
      type: '客戶',
      title: customer.name || '未命名客戶',
      subtitle: customer.email || customer.phone || '客戶主資料',
      href: '/crm/customers',
    }));
    const contactItems = (Array.isArray(boot.contacts) ? boot.contacts : []).map((contact) => ({
      id: `contact-${contact.id}`,
      type: '聯絡人',
      title: contact.name || '未命名聯絡人',
      subtitle: contact.email || contact.phone || '聯絡人資料',
      href: '/crm/contacts',
    }));
    const quoteItems = (Array.isArray(boot.quotes) ? boot.quotes : []).map((quote) => ({
      id: `quote-${quote.id}`,
      type: '報價',
      title: quote.quote_no || `Quote #${quote.id}`,
      subtitle: `${quote.status || 'draft'} · ${Number(quote.total_amount || 0).toFixed(2)}`,
      href: '/crm/quotes',
    }));

    return [...shortcutItems, ...taskItems, ...customerItems, ...contactItems, ...quoteItems];
  };

  const ensureIndex = async () => {
    if (indexLoaded || loading) return;
    setLoading(true);
    setError('');
    try {
      const [taskRes, bootRes] = await Promise.all([api.get('tasks/'), api.get('crm/boot')]);
      const nextItems = buildItems(taskRes.data, bootRes.data);
      setItems(nextItems);
      setIndexLoaded(true);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '搜尋索引載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return items.filter((item) => item.type === '捷徑').slice(0, 6);
    }
    return items
      .filter((item) => {
        const haystack = `${item.type} ${item.title} ${item.subtitle}`.toLowerCase();
        return haystack.includes(keyword);
      })
      .slice(0, 10);
  }, [items, query]);

  return (
    <div
      className="global-search"
      onFocus={() => {
        setOpen(true);
        ensureIndex();
      }}
      onBlur={() => {
        setTimeout(() => setOpen(false), 120);
      }}
    >
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="全域搜尋：任務 / 客戶 / 報價"
      />
      {open ? (
        <div className="global-search__panel">
          {loading ? <p className="panel-hint">載入索引中...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          {!loading && !error && filtered.length === 0 ? <p className="panel-hint">找不到符合結果</p> : null}
          {!loading && !error && filtered.length > 0 ? (
            <ul className="global-search__list">
              {filtered.map((item) => (
                <li key={item.id}>
                  <Link className="global-search__item" to={item.href}>
                    <span className="global-search__type">{item.type}</span>
                    <span className="global-search__title">{item.title}</span>
                    <span className="global-search__subtitle">{item.subtitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default GlobalSearch;
