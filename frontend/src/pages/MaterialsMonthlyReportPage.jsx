import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';

const currentMonthInput = () => new Date().toISOString().slice(0, 7);

const MaterialsMonthlyReportPage = () => {
  const [month, setMonth] = useState(() => currentMonthInput());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const getErrorMessage = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

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
        .filter((row) => Number(row.used_amount || 0) > 0)
        .slice(0, 10),
    [materials],
  );

  return (
    <div className="page">
      <AppHeader
        title="耗材月結報表"
        subtitle="查看本月買多少、用了多少、還有多少庫存。"
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="secondary-button" to="/materials/purchases">進貨入庫</Link>
            <Link className="secondary-button" to="/app">任務列表</Link>
          </div>
        )}
      />

      <section className="panel">
        <div className="panel-header">
          <h2>查詢月份</h2>
        </div>
        <label style={{ maxWidth: 240 }}>
          月份
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel">
        <h2>月結總覽</h2>
        {loading ? (
          <p>載入中...</p>
        ) : (
          <div className="crm-metrics-grid">
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">本月進貨總額</p>
              <h3>NT$ {Number(summary.purchase_total_amount || 0).toFixed(2)}</h3>
            </article>
            <article className="crm-metric-card">
              <p className="crm-metric-card__label">本月耗材成本</p>
              <h3>NT$ {Number(summary.usage_total_amount || 0).toFixed(2)}</h3>
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
          <h2>材料行採購統計</h2>
          <span className="panel-tag">{suppliers.length} 家</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>材料行</th>
                <th>進貨單數</th>
                <th>本月採購總額</th>
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
              {!loading && suppliers.length === 0 ? <tr><td colSpan="3">本月尚無採購資料</td></tr> : null}
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
                <th>單位</th>
                <th>期初庫存</th>
                <th>本月進貨</th>
                <th>本月耗用</th>
                <th>期末庫存</th>
                <th>平均成本</th>
                <th>期末庫存金額</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((row) => (
                <tr key={row.material_item_id}>
                  <td>{row.display_name}</td>
                  <td>{row.unit || '-'}</td>
                  <td>{Number(row.opening_qty || 0).toFixed(2)}</td>
                  <td>{Number(row.purchased_qty || 0).toFixed(2)}</td>
                  <td>{Number(row.used_qty || 0).toFixed(2)}</td>
                  <td>{Number(row.closing_qty || 0).toFixed(2)}</td>
                  <td>{Number(row.average_cost || 0).toFixed(2)}</td>
                  <td>{Number(row.closing_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && materials.length === 0 ? <tr><td colSpan="8">查無月結資料</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>本月耗材成本 Top 10</h2>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>耗材</th>
                <th>耗用量</th>
                <th>耗材成本</th>
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
          <h2>本月進貨單</h2>
          <span className="panel-tag">{purchaseBatches.length} 筆</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>材料行</th>
                <th>結帳月份</th>
                <th>明細筆數</th>
                <th>總額</th>
              </tr>
            </thead>
            <tbody>
              {purchaseBatches.map((row) => (
                <tr key={row.id}>
                  <td>{row.purchase_date || '-'}</td>
                  <td>{row.supplier_name || '-'}</td>
                  <td>{row.statement_month || '-'}</td>
                  <td>{row.item_count || 0}</td>
                  <td>{Number(row.total_amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!loading && purchaseBatches.length === 0 ? <tr><td colSpan="5">本月尚無進貨單</td></tr> : null}
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

