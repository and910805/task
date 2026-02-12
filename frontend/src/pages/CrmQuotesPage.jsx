import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const blankItem = () => ({ description: '', quantity: 1, unit_price: 0 });
const DRAFT_KEY = 'taskgo.quote.draft.v1';
const VERSION_KEY = 'taskgo.quote.versions.v1';
const QUOTE_TEMPLATES = [
  {
    id: 'electrical-basic',
    label: '標準水電施工',
    items: [
      { description: '現場施工工資', quantity: 1, unit_price: 8500 },
      { description: '材料費', quantity: 1, unit_price: 4200 },
      { description: '測試與驗收', quantity: 1, unit_price: 1500 },
    ],
  },
  {
    id: 'maintenance',
    label: '維修保養方案',
    items: [
      { description: '定期巡檢', quantity: 1, unit_price: 3200 },
      { description: '故障檢修', quantity: 1, unit_price: 2600 },
      { description: '耗材更新', quantity: 1, unit_price: 1800 },
    ],
  },
];

const CrmQuotesPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    customer_id: '',
    contact_id: '',
    issue_date: '',
    expiry_date: '',
    currency: 'TWD',
    tax_rate: 5,
    note: '',
  });
  const [items, setItems] = useState([blankItem()]);
  const [templateId, setTemplateId] = useState('');
  const [versionHistory, setVersionHistory] = useState([]);

  const persistDraft = (payload) => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  };

  const pushVersion = (label = '手動儲存') => {
    const snapshot = {
      id: `${Date.now()}`,
      label,
      saved_at: new Date().toISOString(),
      form,
      items,
    };
    const versions = [snapshot, ...versionHistory].slice(0, 12);
    setVersionHistory(versions);
    localStorage.setItem(VERSION_KEY, JSON.stringify(versions));
  };

  const loadBase = async () => {
    const [customerRes, contactRes] = await Promise.all([
      api.get('crm/customers'),
      api.get('crm/contacts'),
    ]);
    setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
    setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
  };

  const loadQuotes = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('crm/quotes');
      setQuotes(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '報價單載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBase();
    loadQuotes();
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft?.form && Array.isArray(draft?.items)) {
        setForm((prev) => ({ ...prev, ...draft.form }));
        setItems(draft.items.length ? draft.items : [blankItem()]);
      }
      const versions = JSON.parse(localStorage.getItem(VERSION_KEY) || '[]');
      setVersionHistory(Array.isArray(versions) ? versions : []);
    } catch {
      // ignore invalid local cache
    }
  }, []);

  useEffect(() => {
    persistDraft({ form, items, updated_at: new Date().toISOString() });
  }, [form, items]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (index) =>
    setItems((prev) => prev.filter((_, idx) => idx !== index).length ? prev.filter((_, idx) => idx !== index) : [blankItem()]);
  const applyTemplate = () => {
    if (!templateId) return;
    const template = QUOTE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setItems(template.items.map((item) => ({ ...item })));
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    if (!form.customer_id) {
      setError('請先選擇客戶');
      return;
    }
    const validItems = items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError('請至少輸入一筆品項');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('crm/quotes', {
        ...form,
        customer_id: Number(form.customer_id),
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        items: validItems.map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
        })),
      });
      setForm({
        customer_id: '',
        contact_id: '',
        issue_date: '',
        expiry_date: '',
        currency: 'TWD',
        tax_rate: 5,
        note: '',
      });
      setItems([blankItem()]);
      localStorage.removeItem(DRAFT_KEY);
      pushVersion('送出前快照');
      await loadQuotes();
    } catch (err) {
      const message = err?.response?.data?.msg || '新增報價失敗';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const convertToInvoice = async (quoteId) => {
    try {
      await api.post(`crm/quotes/${quoteId}/convert-to-invoice`);
      await loadQuotes();
    } catch (err) {
      const message = err?.response?.data?.msg || '轉發票失敗';
      setError(message);
    }
  };

  const openPdf = (quoteId) => {
    const base = (api.defaults.baseURL || '').replace(/\/$/, '');
    window.open(`${base}/crm/quotes/${quoteId}/pdf`, '_blank', 'noopener');
  };

  const contactOptions = useMemo(
    () => contacts.filter((contact) => String(contact.customer_id) === String(form.customer_id)),
    [contacts, form.customer_id],
  );

  return (
    <div className="page">
      <AppHeader title="報價單" subtitle="建立報價單與品項" />

      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <h2>新增報價單</h2>
        <form className="stack" onSubmit={submitQuote}>
          <div className="crm-form-grid">
            <label>
              客戶
              <select name="customer_id" value={form.customer_id} onChange={handleChange}>
                <option value="">選擇客戶</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              聯絡人
              <select name="contact_id" value={form.contact_id} onChange={handleChange}>
                <option value="">選擇聯絡人</option>
                {contactOptions.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              出單日期
              <input type="date" name="issue_date" value={form.issue_date} onChange={handleChange} />
            </label>
            <label>
              到期日
              <input type="date" name="expiry_date" value={form.expiry_date} onChange={handleChange} />
            </label>
            <label>
              稅率 (%)
              <input type="number" name="tax_rate" value={form.tax_rate} onChange={handleChange} step="0.1" />
            </label>
            <label>
              幣別
              <input name="currency" value={form.currency} onChange={handleChange} />
            </label>
            <label className="crm-span-2">
              備註
              <textarea name="note" value={form.note} onChange={handleChange} />
            </label>
          </div>

          <div className="crm-line-tools">
            <button type="button" className="secondary-btn" onClick={() => pushVersion()}>
              儲存版本
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
                if (draft?.form && Array.isArray(draft?.items)) {
                  setForm((prev) => ({ ...prev, ...draft.form }));
                  setItems(draft.items.length ? draft.items : [blankItem()]);
                }
              }}
            >
              載入草稿
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                setForm({
                  customer_id: '',
                  contact_id: '',
                  issue_date: '',
                  expiry_date: '',
                  currency: 'TWD',
                  tax_rate: 5,
                  note: '',
                });
                setItems([blankItem()]);
              }}
            >
              清除草稿
            </button>
          </div>

          <div className="crm-line-items">
            <div className="panel-header">
              <h3>品項</h3>
              <div className="crm-line-tools">
                <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                  <option value="">套用範本（選填）</option>
                  {QUOTE_TEMPLATES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary-btn" onClick={applyTemplate} disabled={!templateId}>
                  套用範本
                </button>
                <button type="button" className="secondary-btn" onClick={addItem}>
                  新增品項
                </button>
              </div>
            </div>
            {items.map((item, idx) => (
              <div key={`${idx}-${item.description}`} className="crm-line-item">
                <input
                  value={item.description}
                  onChange={(event) => handleItemChange(idx, 'description', event.target.value)}
                  placeholder="品項說明"
                />
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(event) => handleItemChange(idx, 'quantity', event.target.value)}
                  placeholder="數量"
                  step="0.1"
                />
                <input
                  type="number"
                  value={item.unit_price}
                  onChange={(event) => handleItemChange(idx, 'unit_price', event.target.value)}
                  placeholder="單價"
                  step="0.1"
                />
                <button type="button" className="secondary-btn" onClick={() => removeItem(idx)}>
                  移除
                </button>
              </div>
            ))}
          </div>

          {versionHistory.length > 0 ? (
            <div className="panel">
              <div className="panel-header">
                <h3>版本紀錄</h3>
                <span className="panel-tag">{versionHistory.length} 筆</span>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>標籤</th>
                      <th>客戶</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versionHistory.map((version) => (
                      <tr key={version.id}>
                        <td>{new Date(version.saved_at).toLocaleString('zh-TW', { hour12: false })}</td>
                        <td>{version.label}</td>
                        <td>{version.form?.customer_id || '-'}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, ...(version.form || {}) }));
                              setItems(Array.isArray(version.items) && version.items.length ? version.items : [blankItem()]);
                            }}
                          >
                            還原
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="crm-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : '建立報價單'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>報價單列表</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>編號</th>
                <th>狀態</th>
                <th>金額</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id}>
                  <td>{quote.quote_no}</td>
                  <td>{quote.status}</td>
                  <td>{quote.total_amount?.toFixed(2)}</td>
                  <td className="crm-actions-cell">
                    <button type="button" className="secondary-btn" onClick={() => openPdf(quote.id)}>
                      PDF
                    </button>
                    <button type="button" onClick={() => convertToInvoice(quote.id)}>
                      轉成發票
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && quotes.length === 0 && (
                <tr>
                  <td colSpan="4">尚無報價單</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="4">載入中...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmQuotesPage;
