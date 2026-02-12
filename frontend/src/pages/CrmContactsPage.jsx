import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const initialForm = {
  customer_id: '',
  name: '',
  title: '',
  email: '',
  phone: '',
  is_primary: false,
  note: '',
};

const CrmContactsPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ ...initialForm });
  const [filterCustomer, setFilterCustomer] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadCustomers = async () => {
    const { data } = await api.get('crm/customers');
    setCustomers(Array.isArray(data) ? data : []);
  };

  const loadContacts = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('crm/contacts', {
        params: filterCustomer ? { customer_id: filterCustomer } : {},
      });
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err?.networkMessage || err?.response?.data?.msg || '聯絡人載入失敗';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
    loadContacts();
  }, []);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.customer_id || !form.name.trim()) {
      setError('請選擇客戶並輸入聯絡人姓名');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('crm/contacts', {
        ...form,
        customer_id: Number(form.customer_id),
      });
      setForm({ ...initialForm });
      await loadContacts();
    } catch (err) {
      const message = err?.response?.data?.msg || '新增聯絡人失敗';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const customerMap = useMemo(
    () => customers.reduce((acc, item) => ({ ...acc, [item.id]: item.name }), {}),
    [customers],
  );

  return (
    <div className="page">
      <AppHeader title="聯絡人管理" subtitle="維護每個客戶的主要聯絡資料" />

      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <h2>新增聯絡人</h2>
        <form className="stack crm-form-grid" onSubmit={handleSubmit}>
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
            姓名
            <input name="name" value={form.name} onChange={handleChange} placeholder="聯絡人姓名" />
          </label>
          <label>
            職稱
            <input name="title" value={form.title} onChange={handleChange} placeholder="選填" />
          </label>
          <label>
            Email
            <input name="email" value={form.email} onChange={handleChange} placeholder="選填" />
          </label>
          <label>
            電話
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="選填" />
          </label>
          <label className="crm-checkbox">
            <input
              type="checkbox"
              name="is_primary"
              checked={form.is_primary}
              onChange={handleChange}
            />
            主要聯絡人
          </label>
          <label className="crm-span-2">
            備註
            <textarea name="note" value={form.note} onChange={handleChange} placeholder="選填" />
          </label>
          <div className="crm-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : '新增聯絡人'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>聯絡人列表</h2>
          <div className="crm-search">
            <select value={filterCustomer} onChange={(event) => setFilterCustomer(event.target.value)}>
              <option value="">全部客戶</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <button type="button" className="secondary-btn" onClick={loadContacts} disabled={loading}>
              篩選
            </button>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>客戶</th>
                <th>Email</th>
                <th>電話</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>{contact.name}</td>
                  <td>{customerMap[contact.customer_id] || '-'}</td>
                  <td>{contact.email || '-'}</td>
                  <td>{contact.phone || '-'}</td>
                </tr>
              ))}
              {!loading && contacts.length === 0 && (
                <tr>
                  <td colSpan="4">尚無聯絡人</td>
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

export default CrmContactsPage;
