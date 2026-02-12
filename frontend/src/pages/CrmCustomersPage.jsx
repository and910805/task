import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const initialForm = {
  name: '',
  tax_id: '',
  email: '',
  phone: '',
  address: '',
  note: '',
};

const CrmCustomersPage = () => {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ ...initialForm });
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('crm/customers', {
        params: search ? { q: search } : {},
      });
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '客戶載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('客戶名稱為必填');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.put(`crm/customers/${editingId}`, form);
      } else {
        await api.post('crm/customers', form);
      }
      setForm({ ...initialForm });
      setEditingId(null);
      await loadCustomers();
    } catch (err) {
      const message = err?.response?.data?.msg || '保存失敗';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (customer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name || '',
      tax_id: customer.tax_id || '',
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      note: customer.note || '',
    });
  };

  const filteredCustomers = useMemo(() => customers, [customers]);

  return (
    <div className="page">
      <AppHeader title="客戶管理" subtitle="新增、維護與搜尋客戶資料" />

      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <div className="panel-header">
          <h2>{editingId ? '編輯客戶' : '新增客戶'}</h2>
          {editingId ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setEditingId(null);
                setForm({ ...initialForm });
              }}
            >
              取消編輯
            </button>
          ) : null}
        </div>
        <form className="stack crm-form-grid" onSubmit={handleSubmit}>
          <label>
            客戶名稱
            <input name="name" value={form.name} onChange={handleChange} placeholder="公司/客戶名稱" />
          </label>
          <label>
            統一編號
            <input name="tax_id" value={form.tax_id} onChange={handleChange} placeholder="選填" />
          </label>
          <label>
            Email
            <input name="email" value={form.email} onChange={handleChange} placeholder="選填" />
          </label>
          <label>
            電話
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="選填" />
          </label>
          <label className="crm-span-2">
            地址
            <input name="address" value={form.address} onChange={handleChange} placeholder="選填" />
          </label>
          <label className="crm-span-2">
            備註
            <textarea name="note" value={form.note} onChange={handleChange} placeholder="客戶說明" />
          </label>
          <div className="crm-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : editingId ? '更新客戶' : '新增客戶'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>客戶列表</h2>
          <div className="crm-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋客戶"
            />
            <button type="button" className="secondary-btn" onClick={loadCustomers} disabled={loading}>
              搜尋
            </button>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>聯絡方式</th>
                <th>統編</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>
                    <div>{customer.email || '-'}</div>
                    <div>{customer.phone || '-'}</div>
                  </td>
                  <td>{customer.tax_id || '-'}</td>
                  <td>
                    <button type="button" className="secondary-btn" onClick={() => handleEdit(customer)}>
                      編輯
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan="4">尚無客戶資料</td>
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

export default CrmCustomersPage;
