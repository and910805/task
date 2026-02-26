import { useEffect, useMemo, useState } from 'react';

import api from '../../api/client.js';
import { managerRoles } from '../../constants/roles.js';
import { useAuth } from '../../context/AuthContext.jsx';

const todayDateInput = () => new Date().toISOString().slice(0, 10);

const buildApiErrorMessage = (err, fallback) => {
  const data = err?.response?.data;
  if (data && typeof data === 'object') {
    if (
      typeof data.msg === 'string' &&
      Object.prototype.hasOwnProperty.call(data, 'qty_on_hand') &&
      Object.prototype.hasOwnProperty.call(data, 'requested_qty')
    ) {
      const material = data.material_name || '耗材';
      return `${data.msg} (${material}; 現有 ${Number(data.qty_on_hand || 0).toFixed(2)}，需求 ${Number(
        data.requested_qty || 0,
      ).toFixed(2)})`;
    }
    if (typeof data.msg === 'string' && data.msg.trim()) return data.msg;
  }
  return err?.networkMessage || fallback;
};

const TaskMaterialsPanel = ({ taskId, taskStatus = '', taskCompletedAt = null }) => {
  const { user } = useAuth();
  const role = user?.role || null;
  const isManager = managerRoles.has(role);
  const isWorker = role === 'worker';
  const workerLocked = isWorker && Boolean(taskCompletedAt || (typeof taskStatus === 'string' && taskStatus === '已完成'));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [materials, setMaterials] = useState([]);
  const [usages, setUsages] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [costVisible, setCostVisible] = useState(isManager);
  const [form, setForm] = useState({
    material_item_id: '',
    used_qty: '',
    unit_cost_snapshot: '',
    used_date: todayDateInput(),
    note: '',
  });

  const loadMaterials = async () => {
    const { data } = await api.get('materials/items', { params: { for_task: 1 } });
    setMaterials(Array.isArray(data) ? data : []);
  };

  const loadUsages = async () => {
    const { data } = await api.get(`materials/tasks/${taskId}/usages`);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    setUsages(rows);
    setTotalCost(Number(data?.total_cost || 0));
    setCostVisible(Boolean(data?.cost_visible ?? isManager));
  };

  const reloadAll = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      await Promise.all([loadMaterials(), loadUsages()]);
    } catch (err) {
      setError(buildApiErrorMessage(err, '載入耗材資料失敗'));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    reloadAll({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const selectedMaterial = useMemo(
    () => materials.find((item) => String(item.id) === String(form.material_item_id)),
    [materials, form.material_item_id],
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (workerLocked) {
      setError('Task is completed; material usage is locked for workers');
      return;
    }
    if (!form.material_item_id) {
      setError('請選擇耗材');
      return;
    }
    if (!form.used_qty || Number(form.used_qty) <= 0) {
      setError('請輸入正確的耗用數量');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        material_item_id: Number(form.material_item_id),
        used_qty: Number(form.used_qty),
        used_date: form.used_date || null,
        note: (form.note || '').trim() || null,
      };
      if (isManager && String(form.unit_cost_snapshot || '').trim() !== '') {
        payload.unit_cost_snapshot = Number(form.unit_cost_snapshot);
      }

      await api.post(`materials/tasks/${taskId}/usages`, payload);
      setMessage('已新增耗材耗用紀錄');
      setForm((prev) => ({
        ...prev,
        material_item_id: '',
        used_qty: '',
        unit_cost_snapshot: '',
        note: '',
      }));
      await loadUsages();
    } catch (err) {
      setError(buildApiErrorMessage(err, '新增耗材耗用失敗'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (usageId) => {
    if (!isManager || !usageId) return;
    if (!window.confirm('確定要刪除這筆耗材耗用紀錄嗎？')) return;
    setDeletingId(usageId);
    setError('');
    setMessage('');
    try {
      await api.delete(`materials/tasks/${taskId}/usages/${usageId}`);
      setMessage('已刪除耗材耗用紀錄');
      await loadUsages();
    } catch (err) {
      setError(buildApiErrorMessage(err, '刪除耗材耗用失敗'));
    } finally {
      setDeletingId(null);
    }
  };

  const estimatedLineCost = useMemo(() => {
    if (!isManager) return '0.00';
    const qty = Number(form.used_qty || 0);
    const cost = Number(form.unit_cost_snapshot || 0);
    return Number.isFinite(qty * cost) ? (qty * cost).toFixed(2) : '0.00';
  }, [form.used_qty, form.unit_cost_snapshot, isManager]);

  return (
    <section className="panel">
      <h2>耗材</h2>

      {workerLocked ? (
        <p className="hint-text" style={{ color: '#b91c1c' }}>
          任務已完成，工人不可再新增或刪除耗材紀錄。
        </p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}

      <form className="stack" onSubmit={handleSubmit}>
        <label>
          耗材
          <select
            name="material_item_id"
            value={form.material_item_id}
            onChange={handleChange}
            disabled={saving || loading || workerLocked}
          >
            <option value="">請選擇耗材</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.display_name || (item.spec ? `${item.name} (${item.spec})` : item.name)}
              </option>
            ))}
          </select>
        </label>

        <div className="crm-form-grid">
          <label>
            耗用數量
            <input
              type="number"
              step="0.01"
              min="0"
              name="used_qty"
              value={form.used_qty}
              onChange={handleChange}
              disabled={saving || loading || workerLocked}
              placeholder={selectedMaterial?.unit ? `單位：${selectedMaterial.unit}` : '數量'}
            />
          </label>

          {isManager ? (
            <label>
              成本單價
              <input
                type="number"
                step="0.01"
                min="0"
                name="unit_cost_snapshot"
                value={form.unit_cost_snapshot}
                onChange={handleChange}
                disabled={saving || loading || workerLocked}
                placeholder="留空自動帶入系統平均成本"
              />
            </label>
          ) : null}

          <label>
            使用日期
            <input
              type="date"
              name="used_date"
              value={form.used_date}
              onChange={handleChange}
              disabled={saving || loading || workerLocked}
            />
          </label>

          {isManager ? (
            <label>
              成本小計(預估)
              <input value={estimatedLineCost} readOnly />
            </label>
          ) : null}
        </div>

        <label>
          備註
          <input
            name="note"
            value={form.note}
            onChange={handleChange}
            disabled={saving || loading || workerLocked}
            placeholder="例如：裁切耗損、補料、退回部分未計"
          />
        </label>

        <button type="submit" disabled={saving || loading || workerLocked}>
          {saving ? '新增中...' : '新增耗材耗用'}
        </button>
      </form>

      <div className="panel-header" style={{ marginTop: 16 }}>
        <h3>耗材耗用紀錄</h3>
        {costVisible ? <span className="panel-tag">總成本 NT$ {Number(totalCost || 0).toFixed(2)}</span> : null}
      </div>

      {loading ? (
        <p>載入中...</p>
      ) : usages.length === 0 ? (
        <p>尚無耗材耗用紀錄。</p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>耗材</th>
                <th>數量</th>
                <th>單位</th>
                {costVisible ? <th>成本單價</th> : null}
                {costVisible ? <th>成本小計</th> : null}
                <th>備註</th>
                {isManager ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {usages.map((row) => (
                <tr key={row.id}>
                  <td>{row.used_date || '-'}</td>
                  <td>{row.material_spec ? `${row.material_name} (${row.material_spec})` : row.material_name}</td>
                  <td>{Number(row.used_qty || 0).toFixed(2)}</td>
                  <td>{row.unit || '-'}</td>
                  {costVisible ? <td>{Number(row.unit_cost_snapshot || 0).toFixed(2)}</td> : null}
                  {costVisible ? <td>{Number(row.total_cost || 0).toFixed(2)}</td> : null}
                  <td>{row.note || '-'}</td>
                  {isManager ? (
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
                  ) : null}
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
