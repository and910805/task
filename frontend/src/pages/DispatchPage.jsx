import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import api from '../api/client.js';
import FieldShell from '../components/FieldShell.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const pad = (value) => String(value).padStart(2, '0');
const toLocalInput = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const nextSlot = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toLocalInput(date);
};

const emptyForm = () => ({
  title: '',
  location: '',
  expectedTime: nextSlot(),
  description: '',
  assigneeIds: [],
});

// Quick dispatch built for phones: the fewest fields a job needs.
const DispatchPage = () => {
  const navigate = useNavigate();
  const { labels } = useRoleLabels();
  const [form, setForm] = useState(emptyForm);
  const [members, setMembers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('auth/assignable-users').then(({ data }) => setMembers(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('site-locations/').then(({ data }) => setLocations(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => (a.role === 'worker' ? -1 : 1) - (b.role === 'worker' ? -1 : 1)),
    [members],
  );

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const toggleAssignee = (id) =>
    setForm((prev) => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(id)
        ? prev.assigneeIds.filter((item) => item !== id)
        : [...prev.assigneeIds, id],
    }));

  const submit = async (event, { again = false } = {}) => {
    event?.preventDefault();
    setError('');
    if (!form.title.trim() || !form.location.trim() || !form.expectedTime) {
      setError('請填寫工作名稱、地點與時間');
      return;
    }
    setSaving(true);
    const location = locations.find((item) => item.name === form.location.trim());
    try {
      const { data } = await api.post('tasks/create', {
        title: form.title.trim(),
        location: form.location.trim(),
        location_url: location?.map_url || undefined,
        description: form.description.trim() || form.title.trim(),
        expected_time: new Date(form.expectedTime).toISOString(),
        status: '尚未接單',
        assignee_ids: form.assigneeIds,
      });
      toast.success(form.assigneeIds.length ? '已派工並通知成員' : '已建立工作（尚未指派）');
      if (again) {
        setForm((prev) => ({ ...emptyForm(), assigneeIds: prev.assigneeIds }));
      } else {
        navigate(`/tasks/${data.id}`);
      }
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '派工失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldShell title="新增派工" subtitle="建立工作並指派現場人員">
      <div className="tg-page__head">
        <div>
          <h1 className="tg-page__title">新增派工</h1>
          <p className="tg-page__sub">指派後，成員會在「今日工作」看到並收到通知。</p>
        </div>
      </div>
      <form className="tg-card" onSubmit={submit}>
        {error ? <p className="tg-error" role="alert">{error}</p> : null}
        <div className="tg-field">
          <label htmlFor="dispatch-title">工作名稱</label>
          <input
            id="dispatch-title"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            maxLength={150}
            required
            placeholder="例如：浴室漏水檢修"
          />
        </div>
        <div className="tg-field">
          <label htmlFor="dispatch-location">地點</label>
          <input
            id="dispatch-location"
            list="dispatch-locations"
            value={form.location}
            onChange={(event) => update('location', event.target.value)}
            maxLength={255}
            required
            placeholder="地址或常用地點"
          />
          <datalist id="dispatch-locations">
            {locations.map((item) => <option value={item.name} key={item.id} />)}
          </datalist>
        </div>
        <div className="tg-field">
          <label htmlFor="dispatch-time">預計時間</label>
          <input
            id="dispatch-time"
            type="datetime-local"
            value={form.expectedTime}
            onChange={(event) => update('expectedTime', event.target.value)}
            required
          />
        </div>
        <div className="tg-field">
          <span className="tg-label">指派給</span>
          {sortedMembers.length ? (
            <div className="tg-list">
              {sortedMembers.map((member) => (
                <label className="tg-check" key={member.id} style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={form.assigneeIds.includes(member.id)}
                    onChange={() => toggleAssignee(member.id)}
                  />
                  <span>
                    {member.username}
                    <small className="tg-hint"> · {labels[member.role] || member.role_label || member.role}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="tg-hint">還沒有可指派的成員，可先建立工作，稍後再指派；或到「成員與邀請」邀請同事。</p>
          )}
        </div>
        <div className="tg-field">
          <label htmlFor="dispatch-description">工作說明（選填）</label>
          <textarea
            id="dispatch-description"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="客戶需求、注意事項、需攜帶材料"
          />
        </div>
        <div className="tg-row">
          <button type="submit" className="tg-button tg-button--accent" disabled={saving}>
            {saving ? '送出中…' : '派工'}
          </button>
          <button type="button" className="tg-button" disabled={saving} onClick={(event) => submit(event, { again: true })}>
            派工並繼續新增
          </button>
        </div>
      </form>
    </FieldShell>
  );
};

export default DispatchPage;
