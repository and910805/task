import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

let lineItemKeySeed = 1;
const nextLineItemKey = () => `line-${lineItemKeySeed++}`;
const blankItem = () => ({ _key: nextLineItemKey(), description: '', unit: '式', quantity: 1, unit_price: 0 });
const withLineItemKey = (item = {}) => ({ _key: nextLineItemKey(), ...item });
const quoteDisplayAmount = (quote) => Number(quote?.subtotal ?? quote?.total_amount ?? 0).toFixed(2);
const toDateInputValue = (value) => value.toISOString().slice(0, 10);
const addDaysToDateInput = (dateInput, days) => {
  if (!dateInput) return '';
  const dateValue = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return '';
  dateValue.setDate(dateValue.getDate() + days);
  return toDateInputValue(dateValue);
};
const defaultQuoteDateFields = () => {
  const today = new Date();
  const issue_date = toDateInputValue(today);
  const expiry_date = addDaysToDateInput(issue_date, 10);
  return { issue_date, expiry_date };
};
const getFilenameFromDisposition = (contentDisposition) => {
  if (!contentDisposition) return '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (err) {
      return utf8Match[1];
    }
  }
  const basicMatch = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
  return basicMatch?.[1] || '';
};

const CrmQuotesPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [history, setHistory] = useState({ quotes: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [versionsForQuoteId, setVersionsForQuoteId] = useState(null);
  const [quoteVersions, setQuoteVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [catalogPick, setCatalogPick] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);

  const [form, setForm] = useState(() => ({
    customer_id: '',
    contact_id: '',
    recipient_name: '',
    ...defaultQuoteDateFields(),
    currency: 'TWD',
    tax_rate: 0,
    note: '',
  }));
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
      setHistory({ quotes: [] });
      return;
    }
    const { data } = await api.get(`crm/customers/${customerId}/service-history`);
    setHistory({
      quotes: Array.isArray(data?.quotes) ? data.quotes : [],
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
      setHistory({ quotes: [] });
    }
  }, [form.customer_id]);

  const contactOptions = useMemo(
    () => contacts.filter((contact) => String(contact.customer_id) === String(form.customer_id)),
    [contacts, form.customer_id],
  );
  const filteredCatalogItems = useMemo(() => {
    const normalizedQuery = (catalogQuery || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return catalogItems.slice(0, 30);
    }
    return catalogItems
      .filter((item) => {
        const haystack = `${item.name || ''} ${item.unit || ''} ${item.note || ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 30);
  }, [catalogItems, catalogQuery]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === 'customer_id') {
      const selectedCustomer = customers.find((customer) => String(customer.id) === String(value));
      setForm((prev) => ({
        ...prev,
        customer_id: value,
        contact_id: '',
        recipient_name: selectedCustomer?.name || prev.recipient_name || '',
      }));
      return;
    }
    if (name === 'contact_id') {
      const selectedContact = contacts.find((contact) => String(contact.id) === String(value));
      setForm((prev) => ({
        ...prev,
        contact_id: value,
        recipient_name: selectedContact?.name || prev.recipient_name,
      }));
      return;
    }
    if (name === 'issue_date') {
      setForm((prev) => {
        const previousAutoExpiry = addDaysToDateInput(prev.issue_date, 10);
        const nextAutoExpiry = addDaysToDateInput(value, 10);
        const shouldSyncExpiry = !prev.expiry_date || prev.expiry_date === previousAutoExpiry;
        return {
          ...prev,
          issue_date: value,
          expiry_date: shouldSyncExpiry ? nextAutoExpiry : prev.expiry_date,
        };
      });
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  };

  const resetForm = () => {
    setForm({
      customer_id: '',
      contact_id: '',
      recipient_name: '',
      ...defaultQuoteDateFields(),
      currency: 'TWD',
      tax_rate: 0,
      note: '',
    });
    setItems([blankItem()]);
    setHistory({ quotes: [] });
    setCatalogPick('');
    setCatalogQuery('');
    setCatalogOpen(false);
    setEditingQuoteId(null);
    setVersionsForQuoteId(null);
    setQuoteVersions([]);
  };

  const addItem = () => setItems((prev) => [...prev, blankItem()]);

  const removeItem = (index) => {
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [blankItem()];
    });
  };

  const addFromCatalog = () => {
    if (!catalogPick) return;
    const selected = catalogItems.find((item) => String(item.id) === String(catalogPick));
    if (!selected) return;
    setItems((prev) => [
      ...prev,
      {
        _key: nextLineItemKey(),
        description: selected.name || '',
        unit: selected.unit || '式',
        quantity: 1,
        unit_price: Number(selected.unit_price || 0),
      },
    ]);
    setCatalogPick('');
    setCatalogQuery('');
    setCatalogOpen(false);
  };
  const chooseCatalogItem = (item) => {
    setCatalogPick(String(item.id));
    setCatalogQuery(item.name || '');
    setCatalogOpen(true);
  };

  const loadQuoteVersions = async (quoteId) => {
    if (!quoteId) return;
    setVersionsLoading(true);
    setError('');
    try {
      const { data } = await api.get(`crm/quotes/${quoteId}/versions`);
      setQuoteVersions(Array.isArray(data?.versions) ? data.versions : []);
      setVersionsForQuoteId(quoteId);
    } catch (err) {
      setError(err?.response?.data?.msg || '載入版本紀錄失敗');
    } finally {
      setVersionsLoading(false);
    }
  };

  const startEditQuote = (quote) => {
    setError('');
    setEditingQuoteId(quote.id);
    setForm({
      customer_id: quote.customer_id ? String(quote.customer_id) : '',
      contact_id: quote.contact_id ? String(quote.contact_id) : '',
      recipient_name: quote.recipient_name || '',
      issue_date: quote.issue_date || '',
      expiry_date: quote.expiry_date || '',
      currency: quote.currency || 'TWD',
      tax_rate: Number(quote.tax_rate || 0),
      note: quote.note || '',
    });
    setItems(
      Array.isArray(quote.items) && quote.items.length > 0
        ? quote.items.map((item) =>
            withLineItemKey({
              description: item.description || '',
              unit: item.unit || '式',
              quantity: item.quantity ?? 1,
              unit_price: item.unit_price ?? 0,
            }),
          )
        : [blankItem()],
    );
    if (quote.customer_id) {
      loadHistory(quote.customer_id).catch(() => null);
    }
    loadQuoteVersions(quote.id).catch(() => null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const payload = {
        ...form,
        customer_id: Number(form.customer_id),
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        recipient_name: (form.recipient_name || '').trim() || null,
        tax_rate: Number(form.tax_rate || 0),
        items: validItems.map((item) => ({
          description: item.description.trim(),
          unit: (item.unit || '式').trim(),
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
        })),
      };
      if (editingQuoteId) {
        await api.put(`crm/quotes/${editingQuoteId}`, payload);
      } else {
        await api.post('crm/quotes', payload);
      }

      resetForm();
      await loadQuotes();
    } catch (err) {
      setError(err?.response?.data?.msg || (editingQuoteId ? '更新報價失敗' : '新增報價失敗'));
    } finally {
      setSaving(false);
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
      const blobPayload = err?.response?.data;
      if (typeof Blob !== 'undefined' && blobPayload instanceof Blob) {
        try {
          const text = await blobPayload.text();
          const parsed = JSON.parse(text);
          const detail = [parsed?.msg, parsed?.detail].filter(Boolean).join(' / ');
          setError(detail || '開啟 PDF 失敗');
          return;
        } catch {
          // Fall through to generic error handling.
        }
      }
      setError(err?.networkMessage || err?.response?.data?.msg || '開啟 PDF 失敗');
    }
  };

  const downloadXlsx = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    try {
      const response = await api.get(`crm/quotes/${quoteId}/xlsx`, { responseType: 'blob' });
      const data = response.data;
      const filenameFromHeader = getFilenameFromDisposition(response.headers?.['content-disposition']);
      const blobUrl = URL.createObjectURL(
        new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      );
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filenameFromHeader || `${quote?.customer_name || 'customer'}-${quote?.quote_no || quoteId}.xlsx`;
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
        {editingQuoteId ? <div className="panel-tag">編輯中：#{editingQuoteId}</div> : null}
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
              台照顯示名稱
              <input
                name="recipient_name"
                value={form.recipient_name}
                onChange={handleChange}
                list="crm-recipient-options"
                placeholder="可選客戶或聯絡人"
              />
              <datalist id="crm-recipient-options">
                {customers.map((customer) => (
                  <option key={`recipient-c-${customer.id}`} value={customer.name} />
                ))}
                {contactOptions.map((contact) => (
                  <option key={`recipient-p-${contact.id}`} value={contact.name} />
                ))}
              </datalist>
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
                <div className="crm-catalog-picker">
                  <input
                    value={catalogQuery}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCatalogQuery(next);
                      setCatalogOpen(true);
                      if (!next.trim()) {
                        setCatalogPick('');
                      }
                    }}
                    onFocus={() => setCatalogOpen(true)}
                    onBlur={() => window.setTimeout(() => setCatalogOpen(false), 120)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (filteredCatalogItems[0]) {
                          chooseCatalogItem(filteredCatalogItems[0]);
                        }
                      }
                    }}
                    placeholder="搜尋價目資料庫（例：網）"
                  />
                  {catalogOpen ? (
                    <div className="crm-catalog-results">
                      {filteredCatalogItems.length > 0 ? (
                        filteredCatalogItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`crm-catalog-option ${String(item.id) === String(catalogPick) ? 'is-active' : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseCatalogItem(item)}
                          >
                            <span>{item.name}</span>
                            <small>{item.unit || '式'} / {Number(item.unit_price || 0).toFixed(0)}</small>
                          </button>
                        ))
                      ) : (
                        <div className="crm-catalog-empty">找不到符合的品項</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <button type="button" className="secondary-btn" onClick={addFromCatalog} disabled={!catalogPick}>
                  帶入品項
                </button>
                <button type="button" className="secondary-btn" onClick={addItem}>
                  新增一列
                </button>
              </div>
            </div>

            {items.map((item, idx) => (
              <div key={item._key || idx} className="crm-line-item">
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
            {editingQuoteId ? (
              <button type="button" className="secondary-btn" onClick={resetForm} disabled={saving}>
                取消編輯
              </button>
            ) : null}
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : editingQuoteId ? '儲存報價單' : '建立報價單'}
            </button>
          </div>
        </form>
      </section>

      {versionsForQuoteId ? (
        <section className="panel panel--table">
          <div className="panel-header">
            <h2>報價版本紀錄</h2>
            <span className="panel-tag">報價單 #{versionsForQuoteId}</span>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>動作</th>
                  <th>時間</th>
                  <th>人員</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {quoteVersions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version_no}</td>
                    <td>{version.action || '-'}</td>
                    <td>{version.created_at || '-'}</td>
                    <td>{version.changed_by_username || '-'}</td>
                    <td>{version.summary || '-'}</td>
                  </tr>
                ))}
                {!versionsLoading && quoteVersions.length === 0 ? (
                  <tr>
                    <td colSpan="5">尚無版本紀錄</td>
                  </tr>
                ) : null}
                {versionsLoading ? (
                  <tr>
                    <td colSpan="5">載入中...</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
                  <td>{quoteDisplayAmount(row)}</td>
                </tr>
              ))}
              {history.quotes.length === 0 ? (
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
                  <td>{quoteDisplayAmount(quote)}</td>
                  <td className="crm-actions-cell">
                    <button type="button" className="secondary-btn" onClick={() => openPdf(quote.id)}>
                      PDF
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => downloadXlsx(quote)}>
                      XLSX
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => startEditQuote(quote)}>
                      編輯
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => loadQuoteVersions(quote.id)}>
                      版本
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
