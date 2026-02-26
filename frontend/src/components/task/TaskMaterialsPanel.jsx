import { useEffect, useMemo, useState } from 'react';

import api from '../../api/client.js';

const todayDateInput = () => new Date().toISOString().slice(0, 10);

const TaskMaterialsPanel = ({ taskId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [materials, setMaterials] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [usages, setUsages] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [form, setForm] = useState({
    material_item_id: '',
    used_qty: '',
    unit_cost_snapshot: '',
    used_date: todayDateInput(),
    note: '',
  });

  const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

  const loadMaterials = async () => {
    const { data } = await api.get('materials/items');
    setMaterials(Array.isArray(data) ? data : []);
  };

  const loadStock = async () => {
    const { data } = await api.get('materials/stock/summary');
    setStockRows(Array.isArray(data?.rows) ? data.rows : []);
  };

  const loadUsages = async () => {
    const { data } = await api.get(`materials/tasks/${taskId}/usages`);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    setUsages(rows);
    setTotalCost(Number(data?.total_cost || 0));
  };

  const reloadAll = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      await Promise.all([loadMaterials(), loadStock(), loadUsages()]);
    } catch (err) {
      setError(getErrorMessage(err, '載入耗材資料失敗'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    reloadAll({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const stockByMaterialId = useMemo(() => {
    const map = new Map();
    stockRows.forEach((row) => {
      map.set(Number(row.id), row);
    });
    return map;
  }, [stockRows]);

  const selectedMaterial = useMemo(
    () => materials.find((item) => String(item.id) === String(form.material_item_id)),
    [materials, form.material_item_id],
  );

  useEffect(() => {
    if (!selectedMaterial) return;
    if (String(form.unit_cost_snapshot || '').trim()) return;
    const stockRow = stockByMaterialId.get(Number(selectedMaterial.id));
    const avgCost = Number(stockRow?.average_cost || selectedMaterial?.reference_cost || 0);
    if (avgCost > 0) {
      setForm((prev) => ({ ...prev, unit_cost_snapshot: String(avgCost) }));
    }
  }, [selectedMaterial, stockByMaterialId, form.unit_cost_snapshot]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.material_item_id) {
      setError('請先選擇耗材');
      return;
    }
    if (!form.used_qty || Number(form.used_qty) <= 0) {
      setError('請輸入正確耗用量');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.post(`materials/tasks/${taskId}/usages`, {
        material_item_id: Number(form.material_item_id),
        used_qty: Number(form.used_qty),
        unit_cost_snapshot: form.unit_cost_snapshot === '' ? null : Number(form.unit_cost_snapshot),
        used_date: form.used_date || null,
        note: (form.note || '').trim() || null,
      });
      setMessage('已新增耗材使用紀錄');
      setForm((prev) => ({
        ...prev,
        material_item_id: '',
        used_qty: '',
        unit_cost_snapshot: '',
        note: '',
      }));
      await Promise.all([loadUsages(), loadStock()]);
    } catch (err) {
      setError(getErrorMessage(err, '新增耗材使用紀錄失敗'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (usageId) => {
    if (!usageId) return;
    const confirmed = window.confirm('確定刪除此筆耗材使用紀錄？');
    if (!confirmed) return;
    setDeletingId(usageId);
    setError('');
    setMessage('');
    try {
      await api.delete(`materials/tasks/${taskId}/usages/${usageId}`);
      setMessage('已刪除耗材使用紀錄');
      await Promise.all([loadUsages(), loadStock()]);
    } catch (err) {
      setError(getErrorMessage(err, '刪除耗材使用紀錄失敗'));
    } finally {
      setDeletingId(null);
    }
  };

  const estimatedLineCost = useMemo(() => {
    const qty = Number(form.used_qty || 0);
    const cost = Number(form.unit_cost_snapshot || 0);
    return Number.isFinite(qty * cost) ? (qty * cost).toFixed(2) : '0.00';
  }, [form.used_qty, form.unit_cost_snapshot]);

  return (
    <section className="panel">
      <h2>耗材紀錄</h2>
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <form className="stack" onSubmit={handleSubmit}>
        <label>
          耗材
          <select name="material_item_id" value={form.material_item_id} onChange={handleChange}>
            <option value="">請選擇耗材</option>
            {materials.map((item) => {
              const stockRow = stockByMaterialId.get(Number(item.id));
              const labelParts = [item.name];
              if (item.spec) labelParts.push(`(${item.spec})`);
              const stockText = stockRow ? `庫存 ${Number(stockRow.qty_on_hand || 0).toFixed(2)} ${item.unit || ''}` : '';
              return (
                <option key={item.id} value={item.id}>
                  {`${labelParts.join(' ')}${stockText ? ` / ${stockText}` : ''}`}
                </option>
              );
            })}
          </select>
        </label>

        <div className="crm-form-grid">
          <label>
            耗用量
            <input
              type="number"
              step="0.01"
              min="0"
              name="used_qty"
              value={form.used_qty}
              onChange={handleChange}
              placeholder={selectedMaterial?.unit ? `單位：${selectedMaterial.unit}` : '數量'}
            />
          </label>
          <label>
            成本單價
            <input
              type="number"
              step="0.01"
              min="0"
              name="unit_cost_snapshot"
              value={form.unit_cost_snapshot}
              onChange={handleChange}
              placeholder="會自動帶入平均成本"
            />
          </label>
          <label>
            使用日期
            <input type="date" name="used_date" value={form.used_date} onChange={handleChange} />
          </label>
          <label>
            成本小計（預估）
            <input value={estimatedLineCost} readOnly />
          </label>
        </div>

        <label>
          備註
          <input
            name="note"
            value={form.note}
            onChange={handleChange}
            placeholder="例如：未用完退回 / 裁切耗損 / 臨時加料"
          />
        </label>

        <button type="submit" disabled={saving || loading}>
          {saving ? '儲存中...' : '新增耗材使用'}
        </button>
      </form>

      <div className="panel-header" style={{ marginTop: 16 }}>
        <h3>本任務耗材明細</h3>
        <span className="panel-tag">總成本 NT$ {Number(totalCost || 0).toFixed(2)}</span>
      </div>

      {loading ? (
        <p>載入中...</p>
      ) : usages.length === 0 ? (
        <p>尚無耗材使用紀錄。</p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>耗材</th>
                <th>數量</th>
                <th>單位</th>
                <th>成本單價</th>
                <th>成本小計</th>
                <th>備註</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((row) => (
                <tr key={row.id}>
                  <td>{row.used_date || '-'}</td>
                  <td>{row.material_spec ? `${row.material_name} (${row.material_spec})` : row.material_name}</td>
                  <td>{Number(row.used_qty || 0).toFixed(2)}</td>
                  <td>{row.unit || '-'}</td>
                  <td>{Number(row.unit_cost_snapshot || 0).toFixed(2)}</td>
                  <td>{Number(row.total_cost || 0).toFixed(2)}</td>
                  <td>{row.note || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleDelete(row.id)}
                      disabled={deletingId === row.id}
                    >
                      {deletingId === row.id ? '刪除中...' : '刪除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default TaskMaterialsPanel;

