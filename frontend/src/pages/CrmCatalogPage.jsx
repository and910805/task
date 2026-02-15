import { useEffect, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const emptyForm = {
  name: '',
  unit: '式',
  unit_price: 0,
  category: '',
  note: '',
  is_active: true,
};

const CrmCatalogPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyRows, setHistoryRows] = useState([]);

  const loadItems = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('crm/catalog-items');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.msg || '價目資料載入失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('請輸入項目名稱');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        unit: (form.unit || '式').trim(),
        category: form.category.trim(),
        note: form.note.trim(),
        unit_price: Number(form.unit_price || 0),
      };
      if (editingId) {
        await api.put(`crm/catalog-items/${editingId}`, payload);
      } else {
        await api.post('crm/catalog-items', payload);
      }
      setForm(emptyForm);
      setEditingId(null);
      await loadItems();
    } catch (err) {
      setError(err?.response?.data?.msg || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const runHistorySearch = async () => {
    const q = historyQuery.trim();
    if (!q) {
      setHistoryRows([]);
      return;
    }
    setError('');
    try {
      const { data } = await api.get('crm/service-history', { params: { q } });
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.msg || '歷史查詢失敗');
    }
  };

  return (
    <div className="page">
      <AppHeader title="價目資料庫" subtitle="建立常用項目（名稱 / 單位 / 單價），估價單可直接帶入。" />

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel">
        <h2>{editingId ? '編輯項目' : '新增項目'}</h2>
        <form className="stack crm-form-grid" onSubmit={submit}>
          <label>
            項目名稱
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如：電視線、配管、工資"
            />
          </label>
          <label>
            單位
            <input
              value={form.unit}
              onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
              placeholder="例如：式、米、組、工"
            />
          </label>
          <label>
            單價
            <input
              type="number"
              step="0.1"
              value={form.unit_price}
              onChange={(event) => setForm((prev) => ({ ...prev, unit_price: event.target.value }))}
            />
          </label>
          <label>
            類別
            <input
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
              placeholder="例如：材料、人工"
            />
          </label>
          <label className="crm-span-2">
            備註
            <textarea value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} />
          </label>
          <label className="crm-checkbox">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
            />
            啟用（可在估價單快速選取）
          </label>
          <div className="crm-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? '儲存中...' : editingId ? '更新項目' : '新增項目'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setForm(emptyForm);
                setEditingId(null);
              }}
            >
              清空
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>項目清單</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>單位</th>
                <th>單價</th>
                <th>類別</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.unit}</td>
                  <td>{Number(item.unit_price || 0).toFixed(2)}</td>
                  <td>{item.category || '-'}</td>
                  <td>{item.is_active ? '啟用' : '停用'}</td>
                  <td className="crm-actions-cell">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setEditingId(item.id);
                        setForm({
                          name: item.name || '',
                          unit: item.unit || '式',
                          unit_price: Number(item.unit_price || 0),
                          category: item.category || '',
                          note: item.note || '',
                          is_active: Boolean(item.is_active),
                        });
                      }}
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.put(`crm/catalog-items/${item.id}`, { is_active: false });
                        await loadItems();
                      }}
                    >
                      停用
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan="6">尚無項目</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="6">載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>客戶施工歷史查詢</h2>
          <div className="crm-search">
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="輸入姓名 / 電話 / Email"
            />
            <button type="button" className="secondary-btn" onClick={runHistorySearch}>
              查詢
            </button>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>客戶</th>
                <th>電話</th>
                <th>歷史筆數</th>
                <th>最近服務</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => {
                const customer = row.customer || {};
                const quoteCount = Array.isArray(row.quotes) ? row.quotes.length : 0;
                const invoiceCount = Array.isArray(row.invoices) ? row.invoices.length : 0;
                const latestQuote = quoteCount > 0 ? row.quotes[0] : null;
                return (
                  <tr key={customer.id}>
                    <td>{customer.name || '-'}</td>
                    <td>{customer.phone || '-'}</td>
                    <td>報價 {quoteCount} / 發票 {invoiceCount}</td>
                    <td>
                      {latestQuote?.items?.[0]?.description || '-'}
                    </td>
                  </tr>
                );
              })}
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan="4">輸入關鍵字後可查詢客戶維修歷史</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CrmCatalogPage;
