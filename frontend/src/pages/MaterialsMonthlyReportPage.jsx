import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const currentMonthInput = () => new Date().toISOString().slice(0, 7);
const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;
const batchStatusLabel = (status) => (String(status || '').toLowerCase() === 'confirmed' ? '已確認' : '待補價');

const MaterialsMonthlyReportPage = () => {
  const [month, setMonth] = useState(() => currentMonthInput());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const loadReport = async (targetMonth) => {
    const [reportRes, txnRes] = await Promise.all([
      api.get('materials/reports/monthly', { params: { month: targetMonth } }),
      api.get('materials/stock/transactions', { params: { month: targetMonth, limit: 200 } }),
    ]);
    setReport(reportRes.data || null);
    setTransactions(Array.isArray(txnRes.data?.rows) ? txnRes.data.rows : []);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        await loadReport(month);
      } catch (err) {
        setError(getErrorMessage(err, '載入月結報表失敗'));
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [month]);

  const summary = report?.summary || {};
  const materials = Array.isArray(report?.materials) ? report.materials : [];
  const suppliers = Array.isArray(report?.suppliers) ? report.suppliers : [];
  const purchaseBatches = Array.isArray(report?.purchase_batches) ? report.purchase_batches : [];

  const topUsageMaterials = useMemo(
    () =>
      [...materials]
        .sort((a, b) => Number(b.used_amount || 0) - Number(a.used_amount || 0))
        .filter((row) => Number(row.used_amount || 0) > 0 || Number(row.estimated_used_amount || 0) > 0)
        .slice(0, 10),
    [materials],
  );

  return (
    <div className="page">
      <AppHeader
        title="耗材月結報表"
        subtitle="正式成本以已確認採購為準；若仍有待補價收貨單，報表會同時顯示暫估資訊。"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="secondary-button" to="/materials/purchases">收貨與補價</Link>
            <Link className="secondary-button" to="/app">回任務</Link>
          </div>
        )}
      />

      <section className="panel">
        <div className="panel-header">
          <h2>月份</h2>
        </div>
        <label style={{ maxWidth: 240 }}>
          月結月份
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {summary.has_unpriced_purchases ? (
        <section className="panel">
          <p className="panel-hint" style={{ color: '#b45309' }}>
            本月仍有待補價收貨單。正式採購金額與正式耗材成本只計入已確認單據，暫估金額會另外顯示。
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h2>月結總覽</h2>
        {loading ? (
          <p>載入中...</p>
        ) : (
          <div className="crm-metrics-grid">
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">正式採購金額</p>
              <h3>NT$ {Number(summary.confirmed_purchase_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">正式耗材成本</p>
              <h3>NT$ {Number(summary.usage_total_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">暫估採購金額</p>
              <h3>NT$ {Number(summary.estimated_purchase_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">暫估耗材成本</p>
              <h3>NT$ {Number(summary.estimated_usage_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">期初庫存金額</p>
              <h3>NT$ {Number(summary.opening_stock_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">期末庫存金額</p>
              <h3>NT$ {Number(summary.closing_stock_amount || 0).toFixed(2)}</h3>
            </article>
          </div>
        )}
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>供應商統計</h2>
          <span className="panel-tag">{suppliers.length} 家</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>供應商</th>
                <th>單據數</th>
                <th>正式金額</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((row) => (
                <tr key={row.supplier_name}>
                  <td>{row.supplier_name}</td>
                  <td>{row.batch_count}</td>
                  <td>{Number(row.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && suppliers.length === 0 ? <tr><td colSpan="3">本月尚無供應商資料</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>耗材月結明細</h2>
          <span className="panel-tag">{materials.length} 項</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>耗材</th>
                <th>期初庫存</th>
                <th>本月進貨</th>
                <th>已確認進貨金額</th>
                <th>本月耗用</th>
                <th>正式耗材成本</th>
                <th>暫估耗材成本</th>
                <th>期末庫存</th>
                <th>期末庫存金額</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((row) => (
                <tr key={row.material_item_id}>
                  <td>
                    <div>{row.display_name}</div>
                    {row.has_unpriced_purchases ? <small style={{ color: '#b45309' }}>含待補價收貨</small> : null}
                  </td>
                  <td>{Number(row.opening_qty || 0).toFixed(2)} {row.unit || ''}</td>
                  <td>{Number(row.purchased_qty || 0).toFixed(2)} {row.unit || ''}</td>
                  <td>{Number(row.confirmed_purchase_amount || 0).toFixed(2)}</td>
                  <td>{Number(row.used_qty || 0).toFixed(2)} {row.unit || ''}</td>
                  <td>{Number(row.used_amount || 0).toFixed(2)}</td>
                  <td>{Number(row.estimated_used_amount || 0).toFixed(2)}</td>
                  <td>{Number(row.closing_qty || 0).toFixed(2)} {row.unit || ''}</td>
                  <td>{Number(row.closing_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && materials.length === 0 ? <tr><td colSpan="9">查無月結資料</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>正式耗材成本 Top 10</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>耗材</th>
                <th>耗用數量</th>
                <th>正式成本</th>
              </tr>
            </thead>
            <tbody>
              {topUsageMaterials.map((row) => (
                <tr key={`top-${row.material_item_id}`}>
                  <td>{row.display_name}</td>
                  <td>{Number(row.used_qty || 0).toFixed(2)} {row.unit || ''}</td>
                  <td>{Number(row.used_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && topUsageMaterials.length === 0 ? <tr><td colSpan="3">本月尚無耗材耗用</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>本月收貨單</h2>
          <span className="panel-tag">{purchaseBatches.length} 筆</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>供應商</th>
                <th>月結月份</th>
                <th>狀態</th>
                <th>未定價</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {purchaseBatches.map((row) => (
                <tr key={row.id}>
                  <td>{row.purchase_date || '-'}</td>
                  <td>{row.supplier_name || '-'}</td>
                  <td>{row.statement_month || '-'}</td>
                  <td>{batchStatusLabel(row.status)}</td>
                  <td>{Number(row.unpriced_item_count || 0)}</td>
                  <td>{Number(row.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && purchaseBatches.length === 0 ? <tr><td colSpan="6">本月尚無收貨單</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>庫存異動帳（本月）</h2>
          <span className="panel-tag">{transactions.length} 筆</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>時間</th>
                <th>類型</th>
                <th>耗材</th>
                <th>數量異動</th>
                <th>單價</th>
                <th>金額異動</th>
                <th>任務</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row) => (
                <tr key={row.id}>
                  <td>{row.txn_date ? new Date(row.txn_date).toLocaleString() : '-'}</td>
                  <td>{row.txn_type}</td>
                  <td>{row.material_spec ? `${row.material_name} (${row.material_spec})` : row.material_name}</td>
                  <td>{Number(row.qty_delta || 0).toFixed(2)}</td>
                  <td>{Number(row.unit_cost || 0).toFixed(2)}</td>
                  <td>{Number(row.amount_delta || 0).toFixed(2)}</td>
                  <td>{row.task_id ? `#${row.task_id}` : '-'}</td>
                </tr>
              ))}
              {!loading && transactions.length === 0 ? <tr><td colSpan="7">本月尚無庫存異動</td></tr> : null}
              {loading ? <tr><td colSpan="7">載入中...</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default MaterialsMonthlyReportPage;
