import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

let purchaseLineSeed = 1;
const nextPurchaseLineKey = () => `purchase-line-${purchaseLineSeed++}`;
const blankPurchaseLine = () => ({
  _key: nextPurchaseLineKey(),
  material_item_id: '',
  quantity: '',
  unit_cost: '',
});

const todayDateInput = () => new Date().toISOString().slice(0, 10);
const currentMonthInput = () => new Date().toISOString().slice(0, 7);

const MaterialsPurchasesPage = () => {
  const [loading, setLoading] = useState(true);
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [materials, setMaterials] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchaseListMonth, setPurchaseListMonth] = useState(() => currentMonthInput());

  const [materialForm, setMaterialForm] = useState({
    name: '',
    spec: '',
    unit: '個',
    reference_cost: '',
  });

  const [purchaseForm, setPurchaseForm] = useState({
    supplier_name: '',
    purchase_date: todayDateInput(),
    statement_month: currentMonthInput(),
    note: '',
  });
  const [purchaseItems, setPurchaseItems] = useState([blankPurchaseLine()]);

  const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

  const loadMaterials = async () => {
    const { data } = await api.get('materials/items', { params: { include_inactive: 1 } });
    setMaterials(Array.isArray(data) ? data : []);
  };

  const loadStock = async () => {
    const { data } = await api.get('materials/stock/summary');
    setStockRows(Array.isArray(data?.rows) ? data.rows : []);
  };

  const loadPurchases = async (month = purchaseListMonth) => {
    const { data } = await api.get('materials/purchases', { params: month ? { month } : undefined });
    setPurchases(Array.isArray(data) ? data : []);
  };

  const reloadAll = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      await Promise.all([loadMaterials(), loadStock(), loadPurchases(purchaseListMonth)]);
    } catch (err) {
      setError(getErrorMessage(err, '載入耗材/進貨資料失敗'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    reloadAll({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPurchases(purchaseListMonth).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseListMonth]);

  const stockByMaterialId = useMemo(() => {
    const map = new Map();
    stockRows.forEach((row) => map.set(Number(row.id), row));
    return map;
  }, [stockRows]);

  const handleMaterialChange = (event) => {
    const { name, value } = event.target;
    setMaterialForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateMaterial = async (event) => {
    event.preventDefault();
    if (!materialForm.name.trim()) {
      setError('請輸入耗材名稱');
      return;
    }
    setSavingMaterial(true);
    setError('');
    setMessage('');
    try {
      await api.post('materials/items', {
        name: materialForm.name.trim(),
        spec: materialForm.spec.trim() || null,
        unit: materialForm.unit.trim() || '個',
        reference_cost: materialForm.reference_cost === '' ? 0 : Number(materialForm.reference_cost),
      });
      setMessage('已新增耗材主檔');
      setMaterialForm({ name: '', spec: '', unit: '個', reference_cost: '' });
      await Promise.all([loadMaterials(), loadStock()]);
    } catch (err) {
      setError(getErrorMessage(err, '新增耗材主檔失敗'));
    } finally {
      setSavingMaterial(false);
    }
  };

  const handlePurchaseFormChange = (event) => {
    const { name, value } = event.target;
    setPurchaseForm((prev) => ({ ...prev, [name]: value }));
  };

  const handlePurchaseItemChange = (index, field, value) => {
    setPurchaseItems((prev) => prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));
  };

  const addPurchaseLine = () => setPurchaseItems((prev) => [...prev, blankPurchaseLine()]);
  const removePurchaseLine = (index) => {
    setPurchaseItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [blankPurchaseLine()];
    });
  };

  const purchasePreviewTotal = useMemo(
    () =>
      purchaseItems.reduce((sum, row) => {
        const qty = Number(row.quantity || 0);
        const unitCost = Number(row.unit_cost || 0);
        return sum + (Number.isFinite(qty * unitCost) ? qty * unitCost : 0);
      }, 0),
    [purchaseItems],
  );

  const handleCreatePurchase = async (event) => {
    event.preventDefault();
    if (!purchaseForm.supplier_name.trim()) {
      setError('請輸入材料行名稱');
      return;
    }
    const validItems = purchaseItems.filter((row) => row.material_item_id && Number(row.quantity) > 0);
    if (validItems.length === 0) {
      setError('請至少輸入一筆進貨明細');
      return;
    }

    setSavingPurchase(true);
    setError('');
    setMessage('');
    try {
      await api.post('materials/purchases', {
        supplier_name: purchaseForm.supplier_name.trim(),
        purchase_date: purchaseForm.purchase_date || null,
        statement_month: purchaseForm.statement_month || null,
        note: purchaseForm.note.trim() || null,
        items: validItems.map((row) => ({
          material_item_id: Number(row.material_item_id),
          quantity: Number(row.quantity || 0),
          unit_cost: Number(row.unit_cost || 0),
        })),
      });
      setMessage('已建立進貨入庫紀錄');
      setPurchaseForm({
        supplier_name: '',
        purchase_date: todayDateInput(),
        statement_month: currentMonthInput(),
        note: '',
      });
      setPurchaseItems([blankPurchaseLine()]);
      await Promise.all([loadPurchases(purchaseListMonth), loadStock(), loadMaterials()]);
    } catch (err) {
      setError(getErrorMessage(err, '建立進貨入庫失敗'));
    } finally {
      setSavingPurchase(false);
    }
  };

  return (
    <div className="page">
      <AppHeader
        title="進貨入庫"
        subtitle="建立耗材主檔、輸入材料行進貨（多筆）、同步更新庫存。"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="secondary-button" to="/materials/reports">月結報表</Link>
            <Link className="secondary-button" to="/app">任務列表</Link>
          </div>
        )}
      />

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <section className="panel">
        <h2>耗材主檔</h2>
        <form className="stack" onSubmit={handleCreateMaterial}>
          <div className="crm-form-grid">
            <label>
              品名
              <input name="name" value={materialForm.name} onChange={handleMaterialChange} placeholder="例如：PVC 水管" />
            </label>
            <label>
              規格
              <input name="spec" value={materialForm.spec} onChange={handleMaterialChange} placeholder="例如：4分" />
            </label>
            <label>
              單位
              <input name="unit" value={materialForm.unit} onChange={handleMaterialChange} placeholder="支 / 米 / 個" />
            </label>
            <label>
              參考成本
              <input
                type="number"
                step="0.01"
                min="0"
                name="reference_cost"
                value={materialForm.reference_cost}
                onChange={handleMaterialChange}
                placeholder="選填"
              />
            </label>
          </div>
          <button type="submit" disabled={savingMaterial}>
            {savingMaterial ? '新增中...' : '新增耗材'}
          </button>
        </form>

        <div className="table-wrapper" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>品名</th>
                <th>規格</th>
                <th>單位</th>
                <th>參考成本</th>
                <th>目前庫存</th>
                <th>平均成本</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((item) => {
                const stock = stockByMaterialId.get(Number(item.id));
                return (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.spec || '-'}</td>
                    <td>{item.unit || '-'}</td>
                    <td>{Number(item.reference_cost || 0).toFixed(2)}</td>
                    <td>{Number(stock?.qty_on_hand || 0).toFixed(2)}</td>
                    <td>{Number(stock?.average_cost ?? item.reference_cost ?? 0).toFixed(2)}</td>
                  </tr>
                );
              })}
              {!loading && materials.length === 0 ? (
                <tr><td colSpan="6">尚無耗材主檔</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>進貨入庫（多筆）</h2>
          <span className="panel-tag">預估總額 NT$ {purchasePreviewTotal.toFixed(2)}</span>
        </div>
        <form className="stack" onSubmit={handleCreatePurchase}>
          <div className="crm-form-grid">
            <label>
              材料行
              <input name="supplier_name" value={purchaseForm.supplier_name} onChange={handlePurchaseFormChange} placeholder="例如：某某材料行" />
            </label>
            <label>
              進貨日期
              <input type="date" name="purchase_date" value={purchaseForm.purchase_date} onChange={handlePurchaseFormChange} />
            </label>
            <label>
              結帳月份
              <input type="month" name="statement_month" value={purchaseForm.statement_month} onChange={handlePurchaseFormChange} />
            </label>
            <label className="crm-span-2">
              備註
              <input name="note" value={purchaseForm.note} onChange={handlePurchaseFormChange} placeholder="選填" />
            </label>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>耗材</th>
                  <th>數量</th>
                  <th>單位</th>
                  <th>單價</th>
                  <th>金額</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {purchaseItems.map((row, idx) => {
                  const material = materials.find((item) => String(item.id) === String(row.material_item_id));
                  const lineAmount = Number(row.quantity || 0) * Number(row.unit_cost || 0);
                  return (
                    <tr key={row._key}>
                      <td>
                        <select
                          value={row.material_item_id}
                          onChange={(event) => handlePurchaseItemChange(idx, 'material_item_id', event.target.value)}
                        >
                          <option value="">請選擇耗材</option>
                          {materials.filter((item) => item.is_active !== false).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.spec ? `${item.name} (${item.spec})` : item.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.quantity}
                          onChange={(event) => handlePurchaseItemChange(idx, 'quantity', event.target.value)}
                        />
                      </td>
                      <td>{material?.unit || '-'}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.unit_cost}
                          onChange={(event) => handlePurchaseItemChange(idx, 'unit_cost', event.target.value)}
                          placeholder={material?.reference_cost ? String(material.reference_cost) : ''}
                        />
                      </td>
                      <td>{Number.isFinite(lineAmount) ? lineAmount.toFixed(2) : '0.00'}</td>
                      <td>
                        <button type="button" className="secondary-button" onClick={() => removePurchaseLine(idx)}>
                          刪除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="secondary-button" onClick={addPurchaseLine}>
              新增一列
            </button>
            <button type="submit" disabled={savingPurchase}>
              {savingPurchase ? '儲存中...' : '建立進貨入庫'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>近期進貨紀錄</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            月份
            <input type="month" value={purchaseListMonth} onChange={(event) => setPurchaseListMonth(event.target.value)} />
          </label>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>材料行</th>
                <th>結帳月份</th>
                <th>筆數</th>
                <th>總額</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.purchase_date || '-'}</td>
                  <td>{batch.supplier_name || '-'}</td>
                  <td>{batch.statement_month || '-'}</td>
                  <td>{Array.isArray(batch.items) ? batch.items.length : 0}</td>
                  <td>{Number(batch.total_amount || 0).toFixed(2)}</td>
                  <td>{batch.note || '-'}</td>
                </tr>
              ))}
              {!loading && purchases.length === 0 ? (
                <tr><td colSpan="6">此月份尚無進貨紀錄</td></tr>
              ) : null}
              {loading ? (
                <tr><td colSpan="6">載入中...</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default MaterialsPurchasesPage;

