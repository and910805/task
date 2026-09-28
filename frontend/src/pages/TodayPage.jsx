import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Camera, CheckCircle2, Clock3, MapPin, Play, Square, UsersRound } from 'lucide-react';

import api from '../api/client.js';
import FieldShell from '../components/FieldShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { MANAGER_ROLES } from '../constants/workspace.js';
import { parseServerUtcDate } from '../utils/datetime.js';

const STATUS_BADGE = {
  尚未接單: 'tg-badge--pending',
  已接單: 'tg-badge--accepted',
  進行中: 'tg-badge--progress',
  已完成: 'tg-badge--done',
};

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatTime = (value) => {
  const date = parseServerUtcDate(value);
  if (!date) return '未排時間';
  const today = new Date();
  const time = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isSameDay(date, today)) return `今天 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
};

const errorText = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;

const runningEntry = (task, userId) =>
  (task.time_entries || []).find((entry) => entry.user_id === userId && entry.start_time && !entry.end_time);

const JobCard = ({ task, userId, busy, onAction, onPhoto, isManager }) => {
  const running = runningEntry(task, userId);
  const assignedToMe = (task.assignee_ids || []).includes(userId) || task.assigned_to_id === userId;
  const canWork = assignedToMe || isManager;
  const myPhotos = (task.attachments || []).filter(
    (item) => item.file_type === 'image' && item.uploaded_by_id === userId,
  ).length;
  const assignees = (task.assignees || []).map((item) => item.username).join('、');

  return (
    <li className="tg-job">
      <Link to={`/tasks/${task.id}`} className="tg-job__main">
        <div className="tg-job__top">
          <h3 className="tg-job__title">{task.title}</h3>
          <span className={`tg-badge ${task.is_overdue ? 'tg-badge--overdue' : STATUS_BADGE[task.status] || ''}`}>
            {task.is_overdue ? '逾期' : task.status}
          </span>
        </div>
        <div className="tg-job__meta">
          <span><Clock3 aria-hidden="true" />{formatTime(task.expected_time)}</span>
          <span><MapPin aria-hidden="true" />{task.location || '未設定地點'}</span>
          {isManager ? <span><UsersRound aria-hidden="true" />{assignees || '尚未指派'}</span> : null}
          {running ? <span className="tg-running">工時計時中</span> : null}
        </div>
      </Link>
      {canWork && task.status !== '已完成' ? (
        <div className="tg-job__actions">
          {task.status === '尚未接單' && assignedToMe ? (
            <button type="button" className="tg-button tg-button--primary" disabled={busy} onClick={() => onAction(task, 'accept')}>
              接單
            </button>
          ) : null}
          {task.status === '已接單' ? (
            <button type="button" className="tg-button tg-button--primary" disabled={busy} onClick={() => onAction(task, 'start')}>
              <Play aria-hidden="true" />開始工作
            </button>
          ) : null}
          {task.status === '進行中' ? (
            <>
              {running ? (
                <button type="button" className="tg-button" disabled={busy} onClick={() => onAction(task, 'stop-timer')}>
                  <Square aria-hidden="true" />結束工時
                </button>
              ) : (
                <button type="button" className="tg-button" disabled={busy} onClick={() => onAction(task, 'start-timer')}>
                  <Play aria-hidden="true" />開始工時
                </button>
              )}
              <button type="button" className="tg-button" disabled={busy} onClick={() => onPhoto(task)}>
                <Camera aria-hidden="true" />拍照{myPhotos ? `（${myPhotos}）` : ''}
              </button>
              <button type="button" className="tg-button tg-button--accent" disabled={busy} onClick={() => onAction(task, 'complete')}>
                <CheckCircle2 aria-hidden="true" />完工
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

const TodayPage = () => {
  const { user, activeWorkspace } = useAuth();
  const isManager = MANAGER_ROLES.includes(user?.role);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [note, setNote] = useState('');
  const photoInputRef = useRef(null);
  const photoTaskRef = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorText(err, '無法載入今日工作'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load, activeWorkspace?.id]);

  const groups = useMemo(() => {
    const now = new Date();
    const open = tasks.filter((task) => task.status !== '已完成' && !task.archived_at);
    const mine = isManager
      ? open
      : open.filter((task) => (task.assignee_ids || []).includes(user?.id) || task.assigned_to_id === user?.id);
    const inProgress = mine.filter((task) => task.status === '進行中' || runningEntry(task, user?.id));
    const inProgressIds = new Set(inProgress.map((task) => task.id));
    const rest = mine.filter((task) => !inProgressIds.has(task.id));
    const overdue = rest.filter((task) => task.is_overdue);
    const overdueIds = new Set(overdue.map((task) => task.id));
    const today = rest.filter((task) => {
      if (overdueIds.has(task.id)) return false;
      const when = parseServerUtcDate(task.expected_time);
      return when && (isSameDay(when, now) || when < now);
    });
    const todayIds = new Set(today.map((task) => task.id));
    const upcoming = rest
      .filter((task) => !overdueIds.has(task.id) && !todayIds.has(task.id))
      .sort((a, b) => String(a.expected_time).localeCompare(String(b.expected_time)))
      .slice(0, 10);
    const unassigned = open.filter((task) => !(task.assignee_ids || []).length && !task.assigned_to_id);
    const doneToday = tasks.filter((task) => {
      const done = parseServerUtcDate(task.completed_at);
      return task.status === '已完成' && done && isSameDay(done, now);
    });
    return { inProgress, overdue, today, upcoming, unassigned, doneToday };
  }, [tasks, isManager, user?.id]);

  const replaceTask = (updated) => setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
  const reloadTask = async (taskId) => {
    const { data } = await api.get(`tasks/${taskId}`);
    replaceTask(data);
    return data;
  };

  const handleAction = async (task, action) => {
    if (action === 'complete') {
      setCompleting(task);
      setNote('');
      return;
    }
    setBusyId(task.id);
    try {
      if (action === 'accept') {
        await api.post(`tasks/${task.id}/updates`, { status: '已接單' });
        toast.success('已接單');
      } else if (action === 'start') {
        await api.post(`tasks/${task.id}/updates`, { status: '進行中' });
        if (!runningEntry(task, user?.id)) await api.post(`tasks/${task.id}/time/start`);
        toast.success('已開始工作，工時計時中');
      } else if (action === 'start-timer') {
        await api.post(`tasks/${task.id}/time/start`);
        toast.success('開始計時');
      } else if (action === 'stop-timer') {
        await api.post(`tasks/${task.id}/time/stop`);
        toast.success('工時已記錄');
      }
      await reloadTask(task.id);
    } catch (err) {
      toast.error(errorText(err, '操作失敗'));
    } finally {
      setBusyId(null);
    }
  };

  const openCamera = (task) => {
    photoTaskRef.current = task;
    photoInputRef.current?.click();
  };

  const handlePhoto = async (event) => {
    const file = event.target.files?.[0];
    const task = photoTaskRef.current;
    event.target.value = '';
    if (!file || !task) return;
    setBusyId(task.id);
    const form = new FormData();
    form.append('file', file);
    form.append('note', '現場照片');
    try {
      await api.post(`upload/tasks/${task.id}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      toast.success('照片已上傳');
      await reloadTask(task.id);
    } catch (err) {
      toast.error(errorText(err, '照片上傳失敗，請確認網路後再試'));
    } finally {
      setBusyId(null);
    }
  };

  const submitCompletion = async (event) => {
    event.preventDefault();
    const task = completing;
    if (!task) return;
    const trimmed = note.trim();
    const myPhotos = (task.attachments || []).filter(
      (item) => item.file_type === 'image' && item.uploaded_by_id === user?.id,
    ).length;
    if (user?.role === 'worker' && (!trimmed || !myPhotos)) {
      toast.error(!trimmed ? '請填寫完工說明' : '完工前請至少拍一張照片');
      return;
    }
    setBusyId(task.id);
    try {
      if (runningEntry(task, user?.id)) await api.post(`tasks/${task.id}/time/stop`);
      await api.post(`tasks/${task.id}/updates`, { status: '已完成', note: trimmed });
      toast.success('已完工回報');
      setCompleting(null);
      await reloadTask(task.id);
    } catch (err) {
      toast.error(errorText(err, '完工回報失敗'));
    } finally {
      setBusyId(null);
    }
  };

  const renderList = (items, empty) =>
    items.length ? (
      <ul className="tg-list">
        {items.map((task) => (
          <JobCard
            key={task.id}
            task={task}
            userId={user?.id}
            busy={busyId === task.id}
            onAction={handleAction}
            onPhoto={openCamera}
            isManager={isManager}
          />
        ))}
      </ul>
    ) : (
      <p className="tg-empty">{empty}</p>
    );

  const todayLabel = new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <FieldShell title="今日工作" subtitle={todayLabel}>
      <div className="tg-page__head">
        <div>
          <h1 className="tg-page__title">今日工作</h1>
          <p className="tg-page__sub">{todayLabel}</p>
        </div>
        {isManager ? (
          <Link to="/dispatch/new" className="tg-button tg-button--accent tg-button--sm">新增派工</Link>
        ) : null}
      </div>

      {error ? (
        <div className="tg-error" role="alert">
          {error}{' '}
          <button type="button" className="tg-button tg-button--sm" onClick={load}>重新整理</button>
        </div>
      ) : null}

      <div className="tg-stats">
        <div className="tg-stat"><strong>{groups.inProgress.length}</strong><span>進行中</span></div>
        <div className="tg-stat"><strong>{groups.today.length}</strong><span>今日待辦</span></div>
        <div className={`tg-stat${groups.overdue.length ? ' tg-stat--warn' : ''}`}>
          <strong>{groups.overdue.length}</strong><span>逾期</span>
        </div>
      </div>

      {loading ? <p className="tg-empty">載入中…</p> : (
        <>
          {completing ? (
            <form className="tg-card tg-section" onSubmit={submitCompletion}>
              <h2 className="tg-section__title">完工回報：{completing.title}</h2>
              <div className="tg-field">
                <label htmlFor="completion-note">完工說明</label>
                <textarea
                  id="completion-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="完成項目、異常狀況、使用材料"
                  required={user?.role === 'worker'}
                />
                <p className="tg-hint">現場人員完工需填寫說明，並至少上傳一張自己拍的照片。</p>
              </div>
              <div className="tg-row">
                <button type="button" className="tg-button" onClick={() => openCamera(completing)} disabled={busyId === completing.id}>
                  <Camera aria-hidden="true" />補拍照片
                </button>
                <button type="submit" className="tg-button tg-button--accent" disabled={busyId === completing.id}>送出完工</button>
                <button type="button" className="tg-button tg-button--ghost" onClick={() => setCompleting(null)}>取消</button>
              </div>
            </form>
          ) : null}

          {groups.inProgress.length ? (
            <section className="tg-section">
              <h2 className="tg-section__title">進行中</h2>
              {renderList(groups.inProgress, '')}
            </section>
          ) : null}

          {groups.overdue.length ? (
            <section className="tg-section">
              <h2 className="tg-section__title">逾期未完成</h2>
              {renderList(groups.overdue, '')}
            </section>
          ) : null}

          <section className="tg-section">
            <h2 className="tg-section__title">今日排程</h2>
            {renderList(groups.today, isManager ? '今天沒有排定的工作。' : '今天沒有指派給你的工作。')}
          </section>

          {isManager && groups.unassigned.length ? (
            <section className="tg-section">
              <h2 className="tg-section__title">
                尚未指派 <small>{groups.unassigned.length} 件</small>
              </h2>
              {renderList(groups.unassigned.slice(0, 5), '')}
            </section>
          ) : null}

          {groups.upcoming.length ? (
            <section className="tg-section">
              <h2 className="tg-section__title">接下來</h2>
              {renderList(groups.upcoming, '')}
            </section>
          ) : null}

          {groups.doneToday.length ? (
            <p className="tg-hint">今天已完成 {groups.doneToday.length} 件。</p>
          ) : null}
        </>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handlePhoto}
      />
    </FieldShell>
  );
};

export default TodayPage;
