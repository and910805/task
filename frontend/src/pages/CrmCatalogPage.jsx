import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const emptyForm = {
  name: '',
  unit: '式',
  unit_price: 0,
  category: '',
  note: '',
  is_active: true,
};

const CrmCatalogPage = () => {
  const { user } = useAuth();
  const isManager = managerRoles.has(user?.role);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyRows, setHistoryRows] = useState([]);

  const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

  const loadItems = async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const params = {
        include_inactive: includeInactive ? 'true' : 'false',
      };
      if (catalogQuery.trim()) params.q = catalogQuery.trim();
      const { data } = await api.get('crm/catalog-items', { params });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err, '價目資料庫載入失敗'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  const submit = async (event) => {
    event.preventDefault();
    if (!isManager) return;
    if (!form.name.trim()) {
      setError('請輸入品項名稱');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        unit: (form.unit || '式').trim(),
        category: (form.category || '').trim(),
        note: (form.note || '').trim(),
        unit_price: Number(form.unit_price || 0),
        is_active: Boolean(form.is_active),
      };

      if (editingId) {
        await api.put(`crm/catalog-items/${editingId}`, payload);
        setMessage('已更新價目品項');
      } else {
        await api.post('crm/catalog-items', payload);
        setMessage('已新增價目品項');
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadItems({ showLoading: false });
    } catch (err) {
      setError(getErrorMessage(err, '儲存價目品項失敗'));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      unit: item.unit || '式',
      unit_price: Number(item.unit_price || 0),
      category: item.category || '',
      note: item.note || '',
      is_active: Boolean(item.is_active),
    });
    setMessage('');
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const toggleItemActive = async (item) => {
    if (!isManager) return;
    setBusyItemId(item.id);
    setError('');
    setMessage('');
    try {
      const nextActive = !Boolean(item.is_active);
      await api.put(`crm/catalog-items/${item.id}`, { is_active: nextActive });
      setMessage(nextActive ? '已重新啟用品項' : '已停用品項');
      await loadItems({ showLoading: false });
    } catch (err) {
      setError(getErrorMessage(err, '更新品項狀態失敗'));
    } finally {
      setBusyItemId(null);
    }
  };

  const deleteItem = async (item) => {
    if (!isManager) return;
    const confirmed = window.confirm(`確定要刪除「${item.name}」嗎？此操作無法復原。`);
    if (!confirmed) return;
    setBusyItemId(item.id);
    setError('');
    setMessage('');
    try {
      await api.delete(`crm/catalog-items/${item.id}`);
      if (editingId === item.id) {
        cancelEdit();
      }
      setMessage('已刪除價目品項');
      await loadItems({ showLoading: false });
    } catch (err) {
      setError(getErrorMessage(err, '刪除價目品項失敗'));
    } finally {
      setBusyItemId(null);
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
      setError(getErrorMessage(err, '服務歷史查詢失敗'));
    }
  };

  const catalogSummary = useMemo(() => {
    const activeCount = items.filter((item) => item.is_active).length;
    const inactiveCount = items.length - activeCount;
    return { activeCount, inactiveCount };
  }, [items]);

  return (
    <div className="page">
      <AppHeader
        title="價目資料庫"
        subtitle="管理常用品項、單位與價格，停用項目可切換顯示後再啟用或刪除"
      />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      {isManager ? (
        <section className="panel">
          <h2>{editingId ? '編輯品項' : '新增品項'}</h2>
          <form className="stack crm-form-grid" onSubmit={submit}>
            <label>
              品項名稱
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="例如：水管更新工資、PVC 管"
              />
            </label>
            <label>
              單位
              <input
                value={form.unit}
                onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                placeholder="式、支、米、個"
              />
            </label>
            <label>
              單價
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.unit_price}
                onChange={(event) => setForm((prev) => ({ ...prev, unit_price: event.target.value }))}
              />
            </label>
            <label>
              分類
              <input
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                placeholder="例如：工資、材料、維修"
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
              啟用（關閉後不會出現在報價單帶入清單）
            </label>
            <div className="crm-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? '儲存中...' : editingId ? '更新品項' : '新增品項'}
              </button>
              <button type="button" className="secondary-button" onClick={cancelEdit}>
                取消
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p className="hint-text">你目前是檢視模式；建立、停用、啟用、刪除價目品項需管理權限。</p>
        </section>
      )}

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>價目品項列表</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="panel-tag">啟用 {catalogSummary.activeCount}</span>
            {includeInactive ? <span className="panel-tag">停用 {catalogSummary.inactiveCount}</span> : null}
          </div>
        </div>

        <div className="crm-search" style={{ marginBottom: 12 }}>
          <input
            value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.target.value)}
            placeholder="搜尋品項名稱或分類"
          />
          <button type="button" className="secondary-button" onClick={() => loadItems()}>
            搜尋
          </button>
          <label className="crm-checkbox" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            顯示停用項目
          </label>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>品項名稱</th>
                <th>單位</th>
                <th>單價</th>
                <th>分類</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.unit || '-'}</td>
                  <td>{Number(item.unit_price || 0).toFixed(2)}</td>
                  <td>{item.category || '-'}</td>
                  <td>{item.is_active ? '啟用' : '停用'}</td>
                  <td className="crm-actions-cell">
                    {isManager ? (
                      <>
                        <button type="button" className="secondary-button" onClick={() => beginEdit(item)}>
                          編輯
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => toggleItemActive(item)}
                          disabled={busyItemId === item.id}
                        >
                          {busyItemId === item.id ? '處理中...' : item.is_active ? '停用' : '啟用'}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => deleteItem(item)}
                          disabled={busyItemId === item.id}
                        >
                          刪除
                        </button>
                      </>
                    ) : (
                      <span>-</span>
                    )}
                  </td>
                </tr>
              ))}

              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan="6">{includeInactive ? '找不到符合條件的品項（含停用）' : '找不到啟用品項'}</td>
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
          <h2>客戶服務歷史查詢</h2>
          <div className="crm-search">
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="輸入姓名、電話或 Email"
            />
            <button type="button" className="secondary-button" onClick={runHistorySearch}>
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
                <th>服務次數</th>
                <th>最近報價品項</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, index) => {
                const customer = row.customer || {};
                const quoteCount = Array.isArray(row.quotes) ? row.quotes.length : 0;
                const latestQuote = quoteCount > 0 ? row.quotes[0] : null;
                return (
                  <tr key={customer.id || `history-${index}`}>
                    <td>{customer.name || '-'}</td>
                    <td>{customer.phone || '-'}</td>
                    <td>報價 {quoteCount}</td>
                    <td>{latestQuote?.items?.[0]?.description || '-'}</td>
                  </tr>
                );
              })}
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan="4">請輸入客戶關鍵字後查詢</td>
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
