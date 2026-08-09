import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CameraOff,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  FilePlus2,
  FileText,
  LayoutDashboard,
  RefreshCw,
  Sparkles,
  UserRound,
  UserRoundX,
  UsersRound,
  Wrench,
} from 'lucide-react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const HOUR_MS = 60 * 60 * 1000;
const COMPLETE_STATUS = '已完成';

const toLocalDateKey = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toCurrency = (value) =>
  Number(value || 0).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  });

const toCompactCurrency = (value) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 10000) {
    return `${(amount / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬`;
  }
  return toCurrency(amount);
};

const formatTaskTime = (value) => {
  if (!value) return '未設定時間';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未設定時間';
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const taskScheduleAt = (task) => task?.due_date || task?.expected_time || null;

const taskAssigneeNames = (task) => {
  const names = (Array.isArray(task?.assignees) ? task.assignees : [])
    .map((item) => item?.username)
    .filter(Boolean);
  if (names.length) return names;
  return task?.assigned_to ? [task.assigned_to] : [];
};

const hasTaskImage = (task) =>
  (Array.isArray(task?.attachments) ? task.attachments : []).some(
    (attachment) => attachment?.file_type === 'image',
  );

const taskIsOverdue = (task, now = new Date()) => {
  if (!task || task.status === COMPLETE_STATUS) return false;
  if (task.is_overdue) return true;
  const scheduledAt = taskScheduleAt(task);
  if (!scheduledAt) return false;
  const timestamp = new Date(scheduledAt).getTime();
  return Number.isFinite(timestamp) && timestamp < now.getTime();
};

const statusClass = (status) => {
  if (status === COMPLETE_STATUS) return 'is-complete';
  if (status === '進行中') return 'is-progress';
  if (status === '已接單') return 'is-accepted';
  return 'is-pending';
};

const quoteStatusLabel = (status) =>
  ({
    draft: '草稿',
    sent: '已送出',
    accepted: '已接受',
    rejected: '未接受',
    expired: '已過期',
  }[status] || status || '未設定');

const OperationsDashboardPage = () => {
  const { user } = useAuth();
  const isManager = managerRoles.has(user?.role);
  const isWorker = user?.role === 'worker';
  const [tasks, setTasks] = useState([]);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crmWarning, setCrmWarning] = useState('');
  const [queueMode, setQueueMode] = useState('attention');
  const [assistantMode, setAssistantMode] = useState('today');

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    setCrmWarning('');

    const requests = [api.get('tasks/')];
    if (isWorker) requests.push(api.get('tasks/', { params: { available: 1 } }));
    if (isManager) {
      requests.push(api.get('crm/quotes', { params: { limit: 200 } }));
      requests.push(api.get('crm/invoices', { params: { limit: 200 } }));
    }

    try {
      const results = await Promise.allSettled(requests);
      const taskResult = results[0];
      if (taskResult.status !== 'fulfilled') throw taskResult.reason;
      setTasks(Array.isArray(taskResult.value?.data) ? taskResult.value.data : []);

      let cursor = 1;
      if (isWorker) {
        const availableResult = results[cursor];
        setAvailableTasks(
          availableResult?.status === 'fulfilled' && Array.isArray(availableResult.value?.data)
            ? availableResult.value.data
            : [],
        );
        cursor += 1;
      } else {
        setAvailableTasks([]);
      }

      if (isManager) {
        const quoteResult = results[cursor];
        const invoiceResult = results[cursor + 1];
        const crmFailed = quoteResult?.status !== 'fulfilled' || invoiceResult?.status !== 'fulfilled';
        setQuotes(
          quoteResult?.status === 'fulfilled' && Array.isArray(quoteResult.value?.data)
            ? quoteResult.value.data
            : [],
        );
        setInvoices(
          invoiceResult?.status === 'fulfilled' && Array.isArray(invoiceResult.value?.data)
            ? invoiceResult.value.data
            : [],
        );
        if (crmFailed) setCrmWarning('任務資料已更新，但報價或請款摘要暫時無法讀取。');
      } else {
        setQuotes([]);
        setInvoices([]);
      }
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '營運資料載入失敗，請重新整理。');
    } finally {
      setLoading(false);
    }
  }, [isManager, isWorker]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const dashboard = useMemo(() => {
    const now = new Date();
    const todayKey = toLocalDateKey(now);
    const incomplete = tasks.filter((task) => task.status !== COMPLETE_STATUS);
    const today = incomplete.filter((task) => toLocalDateKey(taskScheduleAt(task)) === todayKey);
    const overdue = incomplete.filter((task) => taskIsOverdue(task, now));
    const unassigned = isWorker
      ? availableTasks.filter((task) => task.status !== COMPLETE_STATUS)
      : incomplete.filter((task) => taskAssigneeNames(task).length === 0);
    const inProgress = incomplete.filter((task) => task.status === '進行中');
    const completedToday = tasks.filter(
      (task) => task.status === COMPLETE_STATUS && toLocalDateKey(task.completed_at) === todayKey,
    );
    const completedMissingPhotos = tasks.filter(
      (task) => task.status === COMPLETE_STATUS && !hasTaskImage(task),
    );

    const activeTimers = [];
    const timeAnomalies = [];
    for (const task of tasks) {
      for (const entry of Array.isArray(task.time_entries) ? task.time_entries : []) {
        const startedAt = entry?.start_time ? new Date(entry.start_time) : null;
        if (startedAt && !entry?.end_time && !Number.isNaN(startedAt.getTime())) {
          const hours = (now.getTime() - startedAt.getTime()) / HOUR_MS;
          const timer = { task, entry, hours };
          activeTimers.push(timer);
          if (hours > 12) timeAnomalies.push(timer);
        }
        if (Number(entry?.work_hours || 0) > 10) {
          timeAnomalies.push({ task, entry, hours: Number(entry.work_hours) });
        }
      }
    }

    const outstandingInvoices = invoices
      .filter((invoice) => !['paid', 'cancelled'].includes(invoice.status))
      .filter((invoice) => Number(invoice.outstanding_amount || 0) > 0)
      .sort((a, b) => String(a.due_date || a.issue_date || '').localeCompare(String(b.due_date || b.issue_date || '')));
    const outstandingTotal = outstandingInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.outstanding_amount || 0),
      0,
    );
    const draftQuotes = quotes.filter((quote) => quote.status === 'draft');

    const attentionMap = new Map();
    const addAttention = (task, score, reason) => {
      const current = attentionMap.get(task.id);
      if (!current || current.score < score) attentionMap.set(task.id, { task, score, reason });
    };
    overdue.forEach((task) => addAttention(task, 100, '已超過預定時間'));
    unassigned.forEach((task) => addAttention(task, 85, isWorker ? '目前可接單' : '尚未指派人員'));
    today.forEach((task) => addAttention(task, 70, '今日預定工作'));
    completedMissingPhotos.forEach((task) => addAttention(task, 50, '完工但缺少照片'));
    const attention = Array.from(attentionMap.values()).sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return new Date(taskScheduleAt(a.task) || 0) - new Date(taskScheduleAt(b.task) || 0);
    });

    const workloadMap = new Map();
    for (const task of incomplete) {
      const names = taskAssigneeNames(task);
      for (const name of names) {
        const row = workloadMap.get(name) || { name, active: 0, today: 0, hours: 0 };
        row.active += 1;
        if (toLocalDateKey(taskScheduleAt(task)) === todayKey) row.today += 1;
        row.hours += Number(task.total_work_hours || 0);
        workloadMap.set(name, row);
      }
    }
    const workload = Array.from(workloadMap.values()).sort((a, b) => b.active - a.active || b.hours - a.hours);

    return {
      today,
      overdue,
      unassigned,
      inProgress,
      completedToday,
      completedMissingPhotos,
      activeTimers,
      timeAnomalies,
      outstandingInvoices,
      outstandingTotal,
      draftQuotes,
      attention,
      workload,
    };
  }, [availableTasks, invoices, isWorker, quotes, tasks]);

  const queueOptions = useMemo(
    () => [
      { id: 'attention', label: '優先處理', count: dashboard.attention.length },
      { id: 'today', label: '今日', count: dashboard.today.length },
      { id: 'overdue', label: '逾期', count: dashboard.overdue.length },
      {
        id: 'unassigned',
        label: isWorker ? '可接單' : '未指派',
        count: dashboard.unassigned.length,
      },
      { id: 'photos', label: '缺照片', count: dashboard.completedMissingPhotos.length },
    ],
    [dashboard, isWorker],
  );

  const queueRows = useMemo(() => {
    if (queueMode === 'today') return dashboard.today.map((task) => ({ task, reason: '今日預定工作' }));
    if (queueMode === 'overdue') return dashboard.overdue.map((task) => ({ task, reason: '已超過預定時間' }));
    if (queueMode === 'unassigned') {
      return dashboard.unassigned.map((task) => ({ task, reason: isWorker ? '目前可接單' : '尚未指派人員' }));
    }
    if (queueMode === 'photos') {
      return dashboard.completedMissingPhotos.map((task) => ({ task, reason: '完工但缺少照片' }));
    }
    return dashboard.attention;
  }, [dashboard, isWorker, queueMode]);

  const assistantPresets = useMemo(() => {
    const topTask = dashboard.attention[0]?.task;
    const todayAnswer = dashboard.attention.length
      ? `目前有 ${dashboard.attention.length} 件工作需要注意。${topTask ? `建議先處理「${topTask.title}」。` : ''}`
      : '目前沒有逾期、未指派或今日待處理工作，可以安排後續行程。';
    const closeoutAnswer = dashboard.completedMissingPhotos.length
      ? `有 ${dashboard.completedMissingPhotos.length} 件已完工任務沒有施工照片，建議補齊後再結案。`
      : '已完成任務目前都有照片紀錄，完工資料是完整的。';
    const staffingAnswer = dashboard.unassigned.length
      ? `${isWorker ? '目前有' : '目前仍有'} ${dashboard.unassigned.length} 件${isWorker ? '可接' : '未指派'}任務，應先確認時程與人力。`
      : '目前沒有未分派的工作，人員配置暫時完整。';
    const receivableAnswer = dashboard.outstandingInvoices.length
      ? `目前有 ${dashboard.outstandingInvoices.length} 張未收清請款單，待收金額 ${toCurrency(dashboard.outstandingTotal)}。`
      : '目前沒有未收清的請款單。';

    const rows = [
      { id: 'today', label: '今天先處理什麼？', answer: todayAnswer, href: '/tasks', action: '查看任務' },
      { id: 'closeout', label: '哪些完工資料不完整？', answer: closeoutAnswer, href: '/tasks', action: '檢查完工任務' },
      { id: 'staffing', label: isWorker ? '現在有工作可接嗎？' : '人力有沒有漏派？', answer: staffingAnswer, href: '/calendar', action: '查看排程' },
    ];
    if (isManager) {
      rows.push({ id: 'receivable', label: '還有多少款項未收？', answer: receivableAnswer, href: '/crm/quotes', action: '查看請款單' });
    }
    return rows;
  }, [dashboard, isManager, isWorker]);

  const activeAssistant = assistantPresets.find((item) => item.id === assistantMode) || assistantPresets[0];
  const maxWorkload = Math.max(...dashboard.workload.map((row) => row.active), 1);
  const todayText = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const metrics = [
    { label: '今日工作', value: dashboard.today.length, hint: `完成 ${dashboard.completedToday.length} 件`, icon: CalendarDays, tone: 'blue' },
    { label: '進行中', value: dashboard.inProgress.length, hint: `計時中 ${dashboard.activeTimers.length} 筆`, icon: Wrench, tone: 'green' },
    { label: '逾期任務', value: dashboard.overdue.length, hint: dashboard.overdue.length ? '需要優先確認' : '目前無逾期', icon: AlertTriangle, tone: 'red' },
    { label: isWorker ? '可接任務' : '未指派', value: dashboard.unassigned.length, hint: isWorker ? '可自行接單' : '等待安排人員', icon: UserRoundX, tone: 'amber' },
    { label: '工時異常', value: dashboard.timeAnomalies.length, hint: '超時或未結束', icon: Clock3, tone: 'violet' },
    isManager
      ? { label: '待收款', value: toCompactCurrency(dashboard.outstandingTotal), hint: `${dashboard.outstandingInvoices.length} 張請款單`, icon: CircleDollarSign, tone: 'cyan' }
      : { label: '完工缺照片', value: dashboard.completedMissingPhotos.length, hint: '補齊後方便查核', icon: CameraOff, tone: 'cyan' },
  ];

  const quickActions = [
    ...(isManager ? [{ to: '/tasks?new=1', icon: FilePlus2, label: '建立任務', detail: '新增工作並安排人員' }] : []),
    { to: '/tasks', icon: ClipboardList, label: '任務清單', detail: '更新進度與現場紀錄' },
    { to: '/calendar', icon: CalendarDays, label: '行事曆', detail: '查看今天與本週安排' },
    { to: '/attendance', icon: Clock3, label: '出勤中心', detail: '檢查工時與異常紀錄' },
    ...(isManager ? [{ to: '/crm/quotes', icon: FileText, label: '報價請款', detail: '建立報價與追蹤收款' }] : []),
  ];

  return (
    <div className="page operations-dashboard-page">
      <AppHeader
        title="營運工作台"
        subtitle={`${todayText}，先處理真正需要注意的工作。`}
        actions={(
          <button type="button" className="refresh-btn operations-refresh" onClick={() => loadDashboard({ quiet: true })} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            {loading ? '更新中' : '重新整理'}
          </button>
        )}
      />

      {error ? (
        <section className="operations-notice operations-notice--error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div><strong>目前無法載入工作台</strong><p>{error}</p></div>
          <button type="button" onClick={() => loadDashboard()}>重試</button>
        </section>
      ) : null}
      {crmWarning ? <p className="operations-inline-warning">{crmWarning}</p> : null}

      <section className="operations-metrics" aria-label="今日營運摘要">
        {metrics.map(({ label, value, hint, icon, tone }) => (
          <article className={`operations-metric operations-metric--${tone}`} key={label}>
            <span className="operations-metric__icon" aria-hidden="true">{createElement(icon)}</span>
            <div>
              <p>{label}</p>
              <strong>{loading ? '-' : value}</strong>
              <small>{hint}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="operations-main-grid">
        <div className="operations-section operations-queue-section">
          <div className="operations-section__header">
            <div><p className="operations-eyebrow">工作佇列</p><h2>現在要處理的事</h2></div>
            <Link to="/tasks">完整任務清單 <ArrowRight aria-hidden="true" /></Link>
          </div>

          <div className="operations-segments" role="tablist" aria-label="工作佇列篩選">
            {queueOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={queueMode === option.id ? 'is-active' : ''}
                onClick={() => setQueueMode(option.id)}
                role="tab"
                aria-selected={queueMode === option.id}
              >
                {option.label}<span>{option.count}</span>
              </button>
            ))}
          </div>

          <div className="operations-task-list">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => <div className="operations-task-skeleton" key={index} />)
            ) : queueRows.length ? (
              queueRows.slice(0, 8).map(({ task, reason }) => {
                const names = taskAssigneeNames(task);
                return (
                  <Link to={`/tasks/${task.id}`} className="operations-task-row" key={`${queueMode}-${task.id}`}>
                    <span className={`operations-task-row__status ${statusClass(task.status)}`} aria-hidden="true" />
                    <div className="operations-task-row__main">
                      <div className="operations-task-row__title">
                        <strong>{task.title || '未命名任務'}</strong>
                        <span>{task.status || '未設定'}</span>
                      </div>
                      <p>{reason} · {task.location || '未設定地點'}</p>
                    </div>
                    <div className="operations-task-row__meta">
                      <span>{formatTaskTime(taskScheduleAt(task))}</span>
                      <small>{names.length ? names.join('、') : '未指派'}</small>
                    </div>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                );
              })
            ) : (
              <div className="operations-empty">
                <CheckCircle2 aria-hidden="true" />
                <strong>這個分類目前沒有待辦</strong>
                <p>切換其他分類，或前往任務清單安排下一件工作。</p>
              </div>
            )}
          </div>
        </div>

        <aside className="operations-side-stack">
          <section className="operations-section operations-quick-section">
            <div className="operations-section__header"><div><p className="operations-eyebrow">快速入口</p><h2>常用操作</h2></div></div>
            <div className="operations-quick-list">
              {quickActions.map(({ to, icon, label, detail }) => (
                <Link to={to} key={to}>
                  <span aria-hidden="true">{createElement(icon)}</span>
                  <div><strong>{label}</strong><small>{detail}</small></div>
                  <ArrowRight aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>

          <section className="operations-section operations-workload-section">
            <div className="operations-section__header">
              <div><p className="operations-eyebrow">人員負載</p><h2>{isWorker ? '目前工作量' : '團隊分配'}</h2></div>
              <UsersRound aria-hidden="true" />
            </div>
            {dashboard.workload.length ? (
              <div className="operations-workload-list">
                {dashboard.workload.slice(0, 6).map((row) => (
                  <div className="operations-workload-row" key={row.name}>
                    <div><strong>{row.name}</strong><span>今日 {row.today} · 未完工 {row.active}</span></div>
                    <div className="operations-workload-track"><span style={{ width: `${Math.max((row.active / maxWorkload) * 100, 8)}%` }} /></div>
                    <small>{row.hours.toFixed(1)}h</small>
                  </div>
                ))}
              </div>
            ) : <p className="operations-muted">目前沒有已指派的未完工任務。</p>}
          </section>
        </aside>
      </section>

      <section className="operations-lower-grid">
        <div className="operations-section operations-assistant-section">
          <div className="operations-section__header">
            <div><p className="operations-eyebrow">免 Token 助理</p><h2>依目前資料快速判斷</h2></div>
            <span className="operations-local-badge"><Bot aria-hidden="true" /> 本機規則</span>
          </div>
          <div className="operations-assistant-layout">
            <div className="operations-assistant-prompts">
              {assistantPresets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={assistantMode === preset.id ? 'is-active' : ''}
                  onClick={() => setAssistantMode(preset.id)}
                  aria-pressed={assistantMode === preset.id}
                >
                  {preset.label}<ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="operations-assistant-answer" aria-live="polite">
              <span><Sparkles aria-hidden="true" /> 建議</span>
              <p>{activeAssistant?.answer}</p>
              <Link to={activeAssistant?.href || '/tasks'}>{activeAssistant?.action || '查看資料'} <ArrowRight aria-hidden="true" /></Link>
            </div>
          </div>
        </div>

        {isManager ? (
          <div className="operations-section operations-finance-section">
            <div className="operations-section__header">
              <div><p className="operations-eyebrow">報價與收款</p><h2>業務待辦</h2></div>
              <Link to="/crm/quotes">查看全部</Link>
            </div>
            <div className="operations-finance-summary">
              <div><span>報價草稿</span><strong>{dashboard.draftQuotes.length}</strong></div>
              <div><span>未收請款</span><strong>{dashboard.outstandingInvoices.length}</strong></div>
              <div><span>待收金額</span><strong>{toCurrency(dashboard.outstandingTotal)}</strong></div>
            </div>
            <div className="operations-document-list">
              {dashboard.outstandingInvoices.slice(0, 3).map((invoice) => (
                <Link to="/crm/quotes" key={invoice.id}>
                  <div><strong>{invoice.invoice_no || `請款單 #${invoice.id}`}</strong><span>{invoice.customer_name || invoice.recipient_name || '未命名客戶'}</span></div>
                  <div><strong>{toCurrency(invoice.outstanding_amount)}</strong><span>{invoice.due_date || '未設定到期日'}</span></div>
                </Link>
              ))}
              {!dashboard.outstandingInvoices.length
                ? quotes.slice(0, 3).map((quote) => (
                    <Link to="/crm/quotes" key={quote.id}>
                      <div><strong>{quote.quote_no || `報價 #${quote.id}`}</strong><span>{quote.recipient_name || quote.customer_name || '未命名客戶'}</span></div>
                      <div><strong>{toCurrency(quote.total_amount)}</strong><span>{quoteStatusLabel(quote.status)}</span></div>
                    </Link>
                  ))
                : null}
              {!loading && !dashboard.outstandingInvoices.length && !quotes.length ? (
                <p className="operations-muted">目前沒有報價或請款資料。</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="operations-section operations-field-section">
            <div className="operations-section__header"><div><p className="operations-eyebrow">現場提醒</p><h2>完工前確認</h2></div><ClipboardList aria-hidden="true" /></div>
            <ol>
              <li><CheckCircle2 aria-hidden="true" />填寫工作說明與異常狀況</li>
              <li><CheckCircle2 aria-hidden="true" />上傳至少一張施工照片</li>
              <li><CheckCircle2 aria-hidden="true" />停止工時計時後再送出完工</li>
            </ol>
          </div>
        )}
      </section>

      <nav className="operations-mobile-nav" aria-label="手機主要功能">
        <Link to="/app" className="is-active"><LayoutDashboard aria-hidden="true" /><span>工作台</span></Link>
        <Link to="/tasks"><ClipboardList aria-hidden="true" /><span>任務</span></Link>
        <Link to="/calendar"><CalendarDays aria-hidden="true" /><span>行事曆</span></Link>
        <Link to="/attendance"><Clock3 aria-hidden="true" /><span>工時</span></Link>
        <Link to="/profile"><UserRound aria-hidden="true" /><span>帳號</span></Link>
      </nav>
    </div>
  );
};

export default OperationsDashboardPage;
