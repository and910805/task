import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const blankItem = () => ({ description: '', unit: '式', quantity: 1, unit_price: 0 });

const CrmQuotesPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [history, setHistory] = useState({ quotes: [], invoices: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [catalogPick, setCatalogPick] = useState('');

  const [form, setForm] = useState({
    customer_id: '',
    contact_id: '',
    issue_date: '',
    expiry_date: '',
    currency: 'TWD',
    tax_rate: 0,
    note: '',
  });
  const [items, setItems] = useState([blankItem()]);

  const loadBase = async () => {
    const [customerRes, contactRes, catalogRes] = await Promise.all([
      api.get('crm/customers'),
      api.get('crm/contacts'),
      api.get('crm/catalog-items'),
    ]);
    setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
    setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
    setCatalogItems(Array.isArray(catalogRes.data) ? catalogRes.data : []);
  };

  const loadQuotes = async () => {
    const { data } = await api.get('crm/quotes');
    setQuotes(Array.isArray(data) ? data : []);
  };

  const loadHistory = async (customerId) => {
    if (!customerId) {
      setHistory({ quotes: [], invoices: [] });
      return;
    }
    const { data } = await api.get(`crm/customers/${customerId}/service-history`);
    setHistory({
      quotes: Array.isArray(data?.quotes) ? data.quotes : [],
      invoices: Array.isArray(data?.invoices) ? data.invoices : [],
    });
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([loadBase(), loadQuotes()]);
      } catch (err) {
        setError(err?.networkMessage || err?.response?.data?.msg || '報價資料載入失敗');
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    if (form.customer_id) {
      loadHistory(form.customer_id).catch(() => null);
    } else {
      setHistory({ quotes: [], invoices: [] });
    }
  }, [form.customer_id]);

  const contactOptions = useMemo(
    () => contacts.filter((contact) => String(contact.customer_id) === String(form.customer_id)),
    [contacts, form.customer_id],
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'customer_id') {
      setForm((prev) => ({ ...prev, customer_id: value, contact_id: '' }));
    }
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (index) =>
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [blankItem()];
    });

  const addFromCatalog = () => {
    if (!catalogPick) return;
    const selected = catalogItems.find((item) => String(item.id) === String(catalogPick));
    if (!selected) return;
    setItems((prev) => [
      ...prev,
      {
        description: selected.name || '',
        unit: selected.unit || '式',
        quantity: 1,
        unit_price: Number(selected.unit_price || 0),
      },
    ]);
    setCatalogPick('');
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    if (!form.customer_id) {
      setError('請先選擇客戶');
      return;
    }
    const validItems = items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError('請至少填寫一個品項');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.post('crm/quotes', {
        ...form,
        customer_id: Number(form.customer_id),
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        tax_rate: Number(form.tax_rate || 0),
        items: validItems.map((item) => ({
          description: item.description.trim(),
          unit: (item.unit || '式').trim(),
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
        tax_rate: 0,
        note: '',
      });
      setItems([blankItem()]);
      setHistory({ quotes: [], invoices: [] });
      await loadQuotes();
    } catch (err) {
      setError(err?.response?.data?.msg || '新增報價失敗');
    } finally {
      setSaving(false);
    }
  };

  const convertToInvoice = async (quoteId) => {
    try {
      await api.post(`crm/quotes/${quoteId}/convert-to-invoice`);
      await loadQuotes();
    } catch (err) {
      setError(err?.response?.data?.msg || '轉換發票失敗');
    }
  };

  const openPdf = async (quoteId) => {
    try {
      const { data } = await api.get(`crm/quotes/${quoteId}/pdf`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const popup = window.open(blobUrl, '_blank', 'noopener');
      if (!popup) {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '開啟 PDF 失敗');
    }
  };

  const downloadXlsx = async (quoteId) => {
    try {
      const { data } = await api.get(`crm/quotes/${quoteId}/xlsx`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(
        new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      );
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `quote-${quoteId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '下載估價單失敗');
    }
  };

  return (
    <div className="page">
      <AppHeader title="報價單" subtitle="可從價目資料庫帶入品項，並查看客戶歷史施工紀錄。" />

      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <h2>新增報價單</h2>
        <form className="stack" onSubmit={submitQuote}>
          <div className="crm-form-grid">
            <label>
              客戶
              <select name="customer_id" value={form.customer_id} onChange={handleChange}>
                <option value="">請選擇客戶</option>
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
                <option value="">請選擇聯絡人</option>
                {contactOptions.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              報價日期
              <input type="date" name="issue_date" value={form.issue_date} onChange={handleChange} />
            </label>
            <label>
              有效日期
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

          <div className="crm-line-items">
            <div className="panel-header">
              <h3>品項</h3>
              <div className="crm-line-tools">
                <select value={catalogPick} onChange={(event) => setCatalogPick(event.target.value)}>
                  <option value="">從價目資料庫加入</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}（{item.unit} / {Number(item.unit_price || 0).toFixed(0)}）
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary-btn" onClick={addFromCatalog} disabled={!catalogPick}>
                  帶入品項
                </button>
                <button type="button" className="secondary-btn" onClick={addItem}>
                  新增一列
                </button>
              </div>
            </div>

            {items.map((item, idx) => (
              <div key={`${idx}-${item.description}`} className="crm-line-item">
                <input
                  value={item.description}
                  onChange={(event) => handleItemChange(idx, 'description', event.target.value)}
                  placeholder="項目名稱"
                />
                <input
                  value={item.unit}
                  onChange={(event) => handleItemChange(idx, 'unit', event.target.value)}
                  placeholder="單位"
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
                  刪除
                </button>
              </div>
            ))}
          </div>

          <div className="crm-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : '建立報價單'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>客戶歷史施工紀錄</h2>
          <span className="panel-tag">依目前選取客戶</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>類型</th>
                <th>單號</th>
                <th>日期</th>
                <th>第一項目</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {history.quotes.map((row) => (
                <tr key={`q-${row.id}`}>
                  <td>報價</td>
                  <td>{row.quote_no}</td>
                  <td>{row.issue_date || '-'}</td>
                  <td>{row.items?.[0]?.description || '-'}</td>
                  <td>{Number(row.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {history.invoices.map((row) => (
                <tr key={`i-${row.id}`}>
                  <td>發票</td>
                  <td>{row.invoice_no}</td>
                  <td>{row.issue_date || '-'}</td>
                  <td>{row.items?.[0]?.description || '-'}</td>
                  <td>{Number(row.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {history.quotes.length === 0 && history.invoices.length === 0 ? (
                <tr>
                  <td colSpan="5">選擇客戶後可查看歷史紀錄</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>報價單列表</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>單號</th>
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
                  <td>{Number(quote.total_amount || 0).toFixed(2)}</td>
                  <td className="crm-actions-cell">
                    <button type="button" className="secondary-btn" onClick={() => openPdf(quote.id)}>
                      PDF
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => downloadXlsx(quote.id)}>
                      XLSX
                    </button>
                    <button type="button" onClick={() => convertToInvoice(quote.id)}>
                      轉發票
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && quotes.length === 0 ? (
                <tr>
                  <td colSpan="4">尚無報價單</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="4">載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmQuotesPage;
