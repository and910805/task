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

const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;
const batchStatusLabel = (status) => (String(status || '').toLowerCase() === 'confirmed' ? '已確認' : '待補價');
const formatBatchAmount = (batch) => {
  if (String(batch?.status || '').toLowerCase() !== 'confirmed' && Number(batch?.unpriced_item_count || 0) > 0) {
    return '待補';
  }
  return `NT$ ${Number(batch?.total_amount || 0).toFixed(2)}`;
};

const MaterialsPurchasesPage = () => {
  const [loading, setLoading] = useState(true);
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [confirmingBatchId, setConfirmingBatchId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [materials, setMaterials] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchaseListMonth, setPurchaseListMonth] = useState(() => currentMonthInput());
  const [editingBatchId, setEditingBatchId] = useState(null);

  const [materialForm, setMaterialForm] = useState({
    name: '',
    spec: '',
    unit: '式',
    reference_cost: '',
  });

  const [purchaseForm, setPurchaseForm] = useState({
    supplier_name: '',
    purchase_date: todayDateInput(),
    statement_month: currentMonthInput(),
    note: '',
  });
  const [purchaseItems, setPurchaseItems] = useState([blankPurchaseLine()]);

  const resetPurchaseForm = () => {
    setEditingBatchId(null);
    setPurchaseForm({
      supplier_name: '',
      purchase_date: todayDateInput(),
      statement_month: currentMonthInput(),
      note: '',
    });
    setPurchaseItems([blankPurchaseLine()]);
  };

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
      setError(getErrorMessage(err, '載入耗材與收貨資料失敗'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    reloadAll({ showLoading: true });
  }, []);

  useEffect(() => {
    loadPurchases(purchaseListMonth).catch(() => null);
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
        unit: materialForm.unit.trim() || '式',
        reference_cost: materialForm.reference_cost === '' ? 0 : Number(materialForm.reference_cost),
      });
      setMessage('已新增耗材主檔');
      setMaterialForm({ name: '', spec: '', unit: '式', reference_cost: '' });
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

  const validPurchaseItems = useMemo(
    () => purchaseItems.filter((row) => row.material_item_id && Number(row.quantity) > 0),
    [purchaseItems],
  );

  const hasActiveMaterials = materials.some((item) => item.is_active !== false);
  const canSubmitPurchase =
    !savingPurchase &&
    !loading &&
    hasActiveMaterials &&
    Boolean(purchaseForm.supplier_name.trim()) &&
    validPurchaseItems.length > 0;

  const buildPurchasePayload = () => ({
    supplier_name: purchaseForm.supplier_name.trim(),
    purchase_date: purchaseForm.purchase_date || null,
    statement_month: purchaseForm.statement_month || null,
    note: purchaseForm.note.trim() || null,
    status: 'draft',
    items: validPurchaseItems.map((row) => ({
      material_item_id: Number(row.material_item_id),
      quantity: Number(row.quantity || 0),
      unit_cost: row.unit_cost === '' ? null : Number(row.unit_cost || 0),
    })),
  });

  const handleCreateOrUpdatePurchase = async (event) => {
    event?.preventDefault?.();
    if (!purchaseForm.supplier_name.trim()) {
      setError('請輸入材料行 / 供應商');
      return;
    }
    if (validPurchaseItems.length === 0) {
      setError('請至少填寫一筆收貨數量');
      return;
    }
    setSavingPurchase(true);
    setError('');
    setMessage('');
    try {
      const payload = buildPurchasePayload();
      if (editingBatchId) {
        await api.put(`materials/purchases/${editingBatchId}`, payload);
        setMessage('已更新待補價收貨單');
      } else {
        await api.post('materials/purchases', payload);
        setMessage('已建立待補價收貨單');
      }
      resetPurchaseForm();
      await Promise.all([loadPurchases(purchaseListMonth), loadStock(), loadMaterials()]);
    } catch (err) {
      setError(getErrorMessage(err, editingBatchId ? '更新收貨單失敗' : '建立收貨單失敗'));
    } finally {
      setSavingPurchase(false);
    }
  };

  const startEditBatch = async (batchId) => {
    setError('');
    setMessage('');
    try {
      const { data } = await api.get(`materials/purchases/${batchId}`);
      setEditingBatchId(Number(data?.id || batchId));
      setPurchaseForm({
        supplier_name: data?.supplier_name || '',
        purchase_date: data?.purchase_date || todayDateInput(),
        statement_month: data?.statement_month || currentMonthInput(),
        note: data?.note || '',
      });
      setPurchaseItems(
        Array.isArray(data?.items) && data.items.length > 0
          ? data.items.map((item) => ({
              _key: nextPurchaseLineKey(),
              material_item_id: item.material_item_id ? String(item.material_item_id) : '',
              quantity: item.quantity ?? '',
              unit_cost: item.unit_cost ?? '',
            }))
          : [blankPurchaseLine()],
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, '載入收貨單失敗'));
    }
  };

  const confirmBatch = async (batch) => {
    const batchId = Number(batch?.id || 0);
    if (!batchId) return;
    if (!window.confirm(`確認將收貨單 #${batchId} 補價完成並轉為正式採購單嗎？`)) return;
    setConfirmingBatchId(batchId);
    setError('');
    setMessage('');
    try {
      await api.post(`materials/purchases/${batchId}/confirm`);
      setMessage('已確認正式採購成本');
      if (editingBatchId === batchId) {
        resetPurchaseForm();
      }
      await Promise.all([loadPurchases(purchaseListMonth), loadStock(), loadMaterials()]);
    } catch (err) {
      setError(getErrorMessage(err, '確認採購單失敗'));
    } finally {
      setConfirmingBatchId(null);
    }
  };

  return (
    <div className="page">
      <AppHeader
        title="收貨與補價"
        subtitle="先記收貨數量、先讓庫存可用，月底再補材料行單價並確認正式成本。"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="secondary-button" to="/materials/reports">月結報表</Link>
            <Link className="secondary-button" to="/tasks">回任務</Link>
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
              名稱
              <input name="name" value={materialForm.name} onChange={handleMaterialChange} placeholder="例如：PVC 管" />
            </label>
            <label>
              規格
              <input name="spec" value={materialForm.spec} onChange={handleMaterialChange} placeholder="例如：3分" />
            </label>
            <label>
              單位
              <input name="unit" value={materialForm.unit} onChange={handleMaterialChange} placeholder="式 / 支 / 捲" />
            </label>
            <label>
              參考單價
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
                <th>名稱</th>
                <th>規格</th>
                <th>單位</th>
                <th>參考單價</th>
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
          <h2>{editingBatchId ? `補價 / 編輯收貨單 #${editingBatchId}` : '建立收貨單'}</h2>
          <span className="panel-tag">預估金額 NT$ {purchasePreviewTotal.toFixed(2)}</span>
        </div>
        <form className="stack" onSubmit={handleCreateOrUpdatePurchase}>
          <div className="crm-form-grid">
            <label>
              材料行 / 供應商
              <input name="supplier_name" value={purchaseForm.supplier_name} onChange={handlePurchaseFormChange} placeholder="例如：某某材料行" />
            </label>
            <label>
              收貨日期
              <input type="date" name="purchase_date" value={purchaseForm.purchase_date} onChange={handlePurchaseFormChange} />
            </label>
            <label>
              月結月份
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
                  <th>小計</th>
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
                          placeholder={material?.reference_cost ? String(material.reference_cost) : '月底補價可空白'}
                        />
                      </td>
                      <td>{row.unit_cost === '' ? '待補' : (Number.isFinite(lineAmount) ? lineAmount.toFixed(2) : '0.00')}</td>
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
            {editingBatchId ? (
              <button type="button" className="secondary-button" onClick={resetPurchaseForm} disabled={savingPurchase}>
                取消編輯
              </button>
            ) : null}
            <button type="submit" disabled={!canSubmitPurchase}>
              {savingPurchase ? '處理中...' : editingBatchId ? '儲存收貨單' : '建立收貨單'}
            </button>
          </div>
          {!hasActiveMaterials ? <p className="panel-hint">請先建立至少一個耗材主檔，才能建立收貨單。</p> : null}
          {hasActiveMaterials && !purchaseForm.supplier_name.trim() ? <p className="panel-hint">請先填寫供應商。</p> : null}
          {hasActiveMaterials && purchaseForm.supplier_name.trim() && validPurchaseItems.length === 0 ? (
            <p className="panel-hint">請至少選擇一筆耗材並填入大於 0 的數量。</p>
          ) : null}
        </form>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>收貨單列表</h2>
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
                <th>供應商</th>
                <th>月結月份</th>
                <th>狀態</th>
                <th>明細數</th>
                <th>未定價</th>
                <th>金額</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.purchase_date || '-'}</td>
                  <td>{batch.supplier_name || '-'}</td>
                  <td>{batch.statement_month || '-'}</td>
                  <td>{batchStatusLabel(batch.status)}</td>
                  <td>{Array.isArray(batch.items) ? batch.items.length : 0}</td>
                  <td>{Number(batch.unpriced_item_count || 0)}</td>
                  <td>{formatBatchAmount(batch)}</td>
                  <td className="crm-actions-cell">
                    {String(batch.status || '').toLowerCase() === 'draft' ? (
                      <button type="button" className="secondary-button" onClick={() => startEditBatch(batch.id)}>
                        補價 / 編輯
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => confirmBatch(batch)}
                      disabled={String(batch.status || '').toLowerCase() === 'confirmed' || !batch.can_confirm || confirmingBatchId === batch.id}
                    >
                      {String(batch.status || '').toLowerCase() === 'confirmed'
                        ? '已確認'
                        : confirmingBatchId === batch.id
                          ? '確認中...'
                          : '確認單據'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && purchases.length === 0 ? (
                <tr><td colSpan="8">本月尚無收貨單</td></tr>
              ) : null}
              {loading ? (
                <tr><td colSpan="8">載入中...</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default MaterialsPurchasesPage;
