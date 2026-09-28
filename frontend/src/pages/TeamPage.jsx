import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Copy, UserPlus } from 'lucide-react';

import api from '../api/client.js';
import FieldShell from '../components/FieldShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';
import { INDUSTRY_OPTIONS } from '../constants/workspace.js';

const ROLE_ORDER = ['worker', 'site_supervisor', 'hq_staff', 'admin'];
const errorText = (err, fallback) => err?.networkMessage || err?.response?.data?.msg || fallback;
const formatDate = (value) => (value ? new Date(`${value}Z`).toLocaleDateString('zh-TW') : '');

const TeamPage = () => {
  const { user, refreshUser } = useAuth();
  const { labels } = useRoleLabels();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteForm, setInviteForm] = useState({ role: 'worker', days: 7, uses: 1, label: '' });
  const [newCode, setNewCode] = useState(null);
  const [companyForm, setCompanyForm] = useState({ name: '', industry: 'other' });
  const [transferTo, setTransferTo] = useState('');
  const [error, setError] = useState('');
  const isOwner = Boolean(workspace?.is_owner);

  const load = useCallback(async () => {
    setError('');
    try {
      const [ws, users, invites] = await Promise.all([
        api.get('workspaces/current'),
        api.get('auth/users'),
        api.get('workspaces/current/invitations'),
      ]);
      setWorkspace(ws.data);
      setCompanyForm({ name: ws.data.name, industry: ws.data.industry || 'other' });
      setMembers(users.data?.users ?? []);
      setInvitations(invites.data?.invitations ?? []);
    } catch (err) {
      setError(errorText(err, '無法載入成員資料'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, user?.active_workspace_id]);

  const roleName = (role) => labels[role] || role;
  const joinLink = (code) => `${window.location.origin}/join?code=${encodeURIComponent(code)}`;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已複製');
    } catch {
      toast.error('無法自動複製，請手動選取');
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    try {
      const { data } = await api.post('workspaces/current/invitations', {
        role: inviteForm.role,
        expires_in_days: Number(inviteForm.days),
        max_uses: Number(inviteForm.uses),
        label: inviteForm.label,
      });
      setNewCode(data);
      await load();
    } catch (err) {
      toast.error(errorText(err, '建立邀請失敗'));
    }
  };

  const revoke = async (id) => {
    try {
      await api.delete(`workspaces/current/invitations/${id}`);
      await load();
    } catch (err) {
      toast.error(errorText(err, '撤銷失敗'));
    }
  };

  const changeRole = async (member, role) => {
    try {
      await api.put(`auth/users/${member.id}`, { role });
      toast.success('已更新角色');
      await load();
    } catch (err) {
      toast.error(errorText(err, '更新角色失敗'));
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`確定將 ${member.username} 移出公司？指派給他的工作會變成未指派。`)) return;
    try {
      await api.delete(`auth/users/${member.id}`);
      toast.success('已移除成員');
      await load();
    } catch (err) {
      toast.error(errorText(err, '移除失敗'));
    }
  };

  const saveCompany = async (event) => {
    event.preventDefault();
    try {
      await api.put('workspaces/current', { name: companyForm.name, industry: companyForm.industry });
      toast.success('公司資料已更新');
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      toast.error(errorText(err, '更新失敗'));
    }
  };

  const transferOwnership = async () => {
    const target = members.find((member) => String(member.id) === String(transferTo));
    if (!target || !window.confirm(`確定將擁有權轉移給 ${target.username}？轉移後你仍是管理員。`)) return;
    try {
      await api.post('workspaces/current/transfer-ownership', { user_id: target.id });
      toast.success('已轉移擁有權');
      setTransferTo('');
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      toast.error(errorText(err, '轉移失敗'));
    }
  };

  return (
    <FieldShell title="成員與邀請" subtitle="管理公司成員、角色與邀請碼" wide>
      <div className="tg-page__head">
        <div>
          <h1 className="tg-page__title">成員與邀請</h1>
          <p className="tg-page__sub">{workspace?.display_name}</p>
        </div>
      </div>
      {error ? <p className="tg-error" role="alert">{error}</p> : null}

      <section className="tg-card tg-section">
        <h2 className="tg-section__title"><span><UserPlus aria-hidden="true" style={{ width: 18, verticalAlign: '-3px' }} /> 邀請成員</span></h2>
        <form onSubmit={createInvite}>
          <div className="tg-row">
            <div className="tg-field">
              <label htmlFor="invite-role">角色</label>
              <select
                id="invite-role"
                value={inviteForm.role}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, role: event.target.value }))}
              >
                {ROLE_ORDER.filter((role) => role !== 'admin' || isOwner).map((role) => (
                  <option value={role} key={role}>{roleName(role)}</option>
                ))}
              </select>
            </div>
            <div className="tg-field">
              <label htmlFor="invite-days">有效天數</label>
              <input
                id="invite-days"
                type="number"
                min={1}
                max={30}
                value={inviteForm.days}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, days: event.target.value }))}
              />
            </div>
            <div className="tg-field">
              <label htmlFor="invite-uses">可使用人數</label>
              <input
                id="invite-uses"
                type="number"
                min={1}
                max={50}
                value={inviteForm.uses}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, uses: event.target.value }))}
              />
            </div>
            <div className="tg-field">
              <label htmlFor="invite-label">備註（選填）</label>
              <input
                id="invite-label"
                value={inviteForm.label}
                maxLength={120}
                onChange={(event) => setInviteForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="例如：新進師傅"
              />
            </div>
          </div>
          <button type="submit" className="tg-button tg-button--accent" style={{ marginTop: '0.8rem' }}>產生邀請碼</button>
        </form>

        {newCode ? (
          <div style={{ marginTop: '1rem' }}>
            <p className="tg-hint">邀請碼只會顯示這一次，請現在傳給對方：</p>
            <div className="tg-code">
              <span>{newCode.code}</span>
              <button type="button" className="tg-icon-button" onClick={() => copy(newCode.code)} aria-label="複製邀請碼">
                <Copy aria-hidden="true" />
              </button>
            </div>
            <div className="tg-row" style={{ marginTop: '0.6rem' }}>
              <button type="button" className="tg-button tg-button--sm" onClick={() => copy(joinLink(newCode.code))}>複製加入連結</button>
              <span className="tg-hint">
                以「{roleName(newCode.role)}」加入，{formatDate(newCode.expires_at)} 前有效，可用 {newCode.max_uses} 次
              </span>
            </div>
          </div>
        ) : null}

        {invitations.length ? (
          <div className="tg-table-wrap" style={{ marginTop: '1rem' }}>
            <table className="tg-table">
              <thead>
                <tr><th>邀請碼</th><th>角色</th><th>使用</th><th>到期</th><th>狀態</th><th /></tr>
              </thead>
              <tbody>
                {invitations.map((item) => (
                  <tr key={item.id}>
                    <td>…{item.code_hint}{item.label ? <small className="tg-hint"> {item.label}</small> : null}</td>
                    <td>{roleName(item.role)}</td>
                    <td>{item.used_count}/{item.max_uses}</td>
                    <td>{formatDate(item.expires_at)}</td>
                    <td>{item.usable ? '可使用' : item.revoked ? '已撤銷' : '已失效'}</td>
                    <td>
                      {item.usable ? (
                        <button type="button" className="tg-button tg-button--sm tg-button--danger" onClick={() => revoke(item.id)}>撤銷</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="tg-card tg-section">
        <h2 className="tg-section__title">成員 <small>{members.length} 人{workspace?.max_members ? ` / 上限 ${workspace.max_members}` : ''}</small></h2>
        <div className="tg-table-wrap">
          <table className="tg-table">
            <thead>
              <tr><th>帳號</th><th>角色</th><th>進行中工作</th><th /></tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const editable = !member.is_owner && member.id !== user?.id && (isOwner || member.role !== 'admin');
                return (
                  <tr key={member.id}>
                    <td>{member.username}</td>
                    <td>
                      {member.is_owner ? '擁有者' : editable ? (
                        <select
                          value={member.role}
                          onChange={(event) => changeRole(member, event.target.value)}
                          aria-label={`${member.username} 的角色`}
                        >
                          {ROLE_ORDER.filter((role) => role !== 'admin' || isOwner).map((role) => (
                            <option value={role} key={role}>{roleName(role)}</option>
                          ))}
                        </select>
                      ) : roleName(member.role)}
                    </td>
                    <td>{(member.assigned_tasks || []).filter((task) => task.status !== '已完成').length}</td>
                    <td>
                      {editable ? (
                        <button type="button" className="tg-button tg-button--sm tg-button--danger" onClick={() => removeMember(member)}>移出</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tg-card tg-section">
        <h2 className="tg-section__title">公司資料</h2>
        <form onSubmit={saveCompany}>
          <div className="tg-row">
            <div className="tg-field">
              <label htmlFor="company-name">公司名稱</label>
              <input
                id="company-name"
                value={companyForm.name}
                maxLength={120}
                onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
            <div className="tg-field">
              <label htmlFor="company-industry">服務類型</label>
              <select
                id="company-industry"
                value={companyForm.industry}
                onChange={(event) => setCompanyForm((prev) => ({ ...prev, industry: event.target.value }))}
              >
                {INDUSTRY_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="tg-button" style={{ marginTop: '0.8rem' }}>儲存</button>
        </form>
        <p className="tg-hint" style={{ marginTop: '0.8rem' }}>
          方案：{workspace?.plan_label || '—'}。線上付款與方案升級尚未開放。
        </p>
      </section>

      {isOwner ? (
        <section className="tg-card tg-section">
          <h2 className="tg-section__title">轉移擁有權</h2>
          <div className="tg-row">
            <div className="tg-field">
              <label htmlFor="transfer-to">新的擁有者</label>
              <select id="transfer-to" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                <option value="">選擇成員</option>
                {members.filter((member) => member.id !== user?.id).map((member) => (
                  <option value={member.id} key={member.id}>{member.username}</option>
                ))}
              </select>
            </div>
            <button type="button" className="tg-button tg-button--danger" disabled={!transferTo} onClick={transferOwnership}>轉移</button>
          </div>
        </section>
      ) : null}
    </FieldShell>
  );
};

export default TeamPage;
