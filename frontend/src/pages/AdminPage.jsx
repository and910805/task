import { useEffect, useState } from 'react';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { defaultRoleLabels } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const FALLBACK_TASK_STATUSES = ['尚未接單', '進行中', '已完成'];

const AdminPage = () => {
  const { user, logout } = useAuth();
  const {
    branding,
    loading: brandingLoading,
    updateName: updateBrandingName,
    uploadLogo: uploadBrandingLogo,
    removeLogo: removeBrandingLogo,
  } = useBranding();
  const { labels, options, overrides, updateRoleLabel, resetRoleLabel } = useRoleLabels();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [userCount, setUserCount] = useState(0);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    role: 'worker',
  });
  const [roleNameEdits, setRoleNameEdits] = useState({ ...labels });
  const [roleLabelMessages, setRoleLabelMessages] = useState({});
  const [roleLabelBusy, setRoleLabelBusy] = useState({});
  const [brandingName, setBrandingName] = useState(branding.name);
  const [brandingMessage, setBrandingMessage] = useState(null);
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);

  const [emailSettings, setEmailSettings] = useState({
  enabled: true,
  send_on_assignment: true,
  send_on_status_change: true,
  status_targets: [...FALLBACK_TASK_STATUSES],
  subject_prefix: '',
  include_task_link: false,
  task_link_base_url: '',
});
  const [emailStatusOptions, setEmailStatusOptions] = useState([...FALLBACK_TASK_STATUSES]);
  const [emailSettingsBusy, setEmailSettingsBusy] = useState(false);
  const [emailSettingsMessage, setEmailSettingsMessage] = useState(null);

  const [lineSettings, setLineSettings] = useState({
    enabled: true,
    send_on_assignment: true,
    send_on_status_change: true,
    status_targets: [],
    include_task_link: false,
    task_link_base_url: '',
  });
  const [lineStatusOptions, setLineStatusOptions] = useState([...FALLBACK_TASK_STATUSES]);
  const [lineHasBot, setLineHasBot] = useState(false);
  const [lineSettingsBusy, setLineSettingsBusy] = useState(false);
  const [lineSettingsMessage, setLineSettingsMessage] = useState(null);

  useEffect(() => {
    setRoleNameEdits({ ...labels });
  }, [labels]);

  useEffect(() => {
    setBrandingName(branding.name);
  }, [branding.name]);

  const workerLabel = labels.worker || defaultRoleLabels.worker;

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('auth/users');
      const list = Array.isArray(data) ? data : data?.users ?? [];
      const total = Array.isArray(data) ? data.length : data?.total;
      setUsers(list);
      setUserCount(typeof total === 'number' ? total : list.length);
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) {
        logout();
        setError('登入資訊已失效，請重新登入。');
      } else {
        const message = err.response?.data?.msg || '無法取得使用者列表。';
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };



  const loadEmailSettings = async () => {
  setEmailSettingsMessage(null);
  try {
    const { data } = await api.get('settings/notifications/email');
    const incoming = data?.settings ?? {};
    const statusOptions = Array.isArray(data?.status_options) && data.status_options.length > 0
      ? data.status_options
      : FALLBACK_TASK_STATUSES;

    setEmailStatusOptions(statusOptions);
    setEmailSettings((prev) => ({
      ...prev,
      ...incoming,
      status_targets: Array.isArray(incoming.status_targets)
        ? incoming.status_targets
        : prev.status_targets,
    }));
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      logout();
      setEmailSettingsMessage({ type: 'error', text: '登入資訊已失效，請重新登入。' });
    } else if (status === 403) {
      setEmailSettingsMessage({ type: 'error', text: '權限不足，無法讀取信件設定。' });
    } else {
      const message = err.response?.data?.msg || '無法讀取信件設定。';
      setEmailSettingsMessage({ type: 'error', text: message });
    }
  }
};

  const saveEmailSettings = async () => {
  setEmailSettingsBusy(true);
  setEmailSettingsMessage(null);
  try {
    const payload = {
      enabled: Boolean(emailSettings.enabled),
      send_on_assignment: Boolean(emailSettings.send_on_assignment),
      send_on_status_change: Boolean(emailSettings.send_on_status_change),
      status_targets: Array.isArray(emailSettings.status_targets) ? emailSettings.status_targets : [],
      subject_prefix: emailSettings.subject_prefix ?? '',
      include_task_link: Boolean(emailSettings.include_task_link),
      task_link_base_url: emailSettings.task_link_base_url ?? '',
    };

    const { data } = await api.put('settings/notifications/email', payload);
    const updated = data?.settings ?? payload;
    const statusOptions = Array.isArray(data?.status_options) && data.status_options.length > 0
      ? data.status_options
      : emailStatusOptions;

    setEmailStatusOptions(statusOptions);
    setEmailSettings((prev) => ({
      ...prev,
      ...updated,
      status_targets: Array.isArray(updated.status_targets) ? updated.status_targets : prev.status_targets,
    }));
    setEmailSettingsMessage({ type: 'success', text: '已更新信件通知設定。' });
  } catch (err) {
    const message = err.response?.data?.msg || '更新信件通知設定失敗。';
    setEmailSettingsMessage({ type: 'error', text: message });
  } finally {
    setEmailSettingsBusy(false);
  }
};

  const toggleEmailStatusTarget = (status) => {
  setEmailSettingsMessage(null);
  setEmailSettings((prev) => {
    const current = new Set(Array.isArray(prev.status_targets) ? prev.status_targets : []);
    if (current.has(status)) {
      current.delete(status);
    } else {
      current.add(status);
    }
    return { ...prev, status_targets: Array.from(current) };
  });
};

  const setEmailStatusAll = () => {
  setEmailSettingsMessage(null);
  setEmailSettings((prev) => ({ ...prev, status_targets: [] }));
};

  const setEmailStatusSelectAll = () => {
  setEmailSettingsMessage(null);
  setEmailSettings((prev) => ({ ...prev, status_targets: [...emailStatusOptions] }));
};

  const loadLineSettings = async () => {
    setLineSettingsMessage(null);
    try {
      const { data } = await api.get('settings/notifications/line');
      const incoming = data?.settings ?? {};
      const statusOptions = Array.isArray(data?.status_options) && data.status_options.length > 0
        ? data.status_options
        : FALLBACK_TASK_STATUSES;

      setLineHasBot(Boolean(data?.has_line_bot));
      setLineStatusOptions(statusOptions);
      setLineSettings((prev) => ({
        ...prev,
        ...incoming,
        status_targets: Array.isArray(incoming.status_targets) ? incoming.status_targets : prev.status_targets,
      }));
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) {
        logout();
        setLineSettingsMessage({ type: 'error', text: '登入資訊已失效，請重新登入。' });
      } else if (status === 403) {
        setLineSettingsMessage({ type: 'error', text: '權限不足，無法讀取 LINE 設定。' });
      } else {
        const message = err.response?.data?.msg || '無法讀取 LINE 設定。';
        setLineSettingsMessage({ type: 'error', text: message });
      }
    }
  };

  const saveLineSettings = async () => {
    setLineSettingsBusy(true);
    setLineSettingsMessage(null);
    try {
      const payload = {
        enabled: Boolean(lineSettings.enabled),
        send_on_assignment: Boolean(lineSettings.send_on_assignment),
        send_on_status_change: Boolean(lineSettings.send_on_status_change),
        status_targets: Array.isArray(lineSettings.status_targets) ? lineSettings.status_targets : [],
        include_task_link: Boolean(lineSettings.include_task_link),
        task_link_base_url: lineSettings.task_link_base_url ?? '',
      };

      const { data } = await api.put('settings/notifications/line', payload);
      const updated = data?.settings ?? payload;
      const statusOptions = Array.isArray(data?.status_options) && data.status_options.length > 0
        ? data.status_options
        : lineStatusOptions;

      setLineStatusOptions(statusOptions);
      setLineSettings((prev) => ({
        ...prev,
        ...updated,
        status_targets: Array.isArray(updated.status_targets) ? updated.status_targets : prev.status_targets,
      }));
      setLineSettingsMessage({ type: 'success', text: '已更新 LINE 通知設定。' });
    } catch (err) {
      const message = err.response?.data?.msg || '更新 LINE 通知設定失敗。';
      setLineSettingsMessage({ type: 'error', text: message });
    } finally {
      setLineSettingsBusy(false);
    }
  };

  const toggleLineStatusTarget = (status) => {
    setLineSettingsMessage(null);
    setLineSettings((prev) => {
      const current = new Set(Array.isArray(prev.status_targets) ? prev.status_targets : []);
      if (current.has(status)) current.delete(status);
      else current.add(status);
      return { ...prev, status_targets: Array.from(current) };
    });
  };

  const setLineStatusAll = () => {
    setLineSettingsMessage(null);
    setLineSettings((prev) => ({ ...prev, status_targets: [] }));
  };

  const setLineStatusSelectAll = () => {
    setLineSettingsMessage(null);
    setLineSettings((prev) => ({ ...prev, status_targets: [...lineStatusOptions] }));
  };

  useEffect(() => {
    loadUsers();
    loadEmailSettings();
    loadLineSettings();
  }, []);

  const handleExport = async () => {
    setExportError('');
    setExportSuccess('');
    setExporting(true);
    try {
      const { data } = await api.get('export/tasks');
      const downloadUrl = data?.url;
      if (downloadUrl) {
        const resolvedUrl = /^https?:\/\//i.test(downloadUrl)
          ? downloadUrl
          : new URL(downloadUrl, window.location.origin).toString();
        window.open(resolvedUrl, '_blank', 'noopener');
        setExportSuccess('報表匯出完成，已在新分頁開啟下載。');
      } else {
        setExportSuccess('報表已產生。');
      }
    } catch (err) {
      const message = err.response?.data?.msg || '匯出報表失敗。';
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleBrandingNameSave = async () => {
    const value = (brandingName || '').trim();
    if (!value) {
      setBrandingMessage({ type: 'error', text: '請輸入登入畫面名稱' });
      return;
    }

    setBrandingBusy(true);
    setBrandingMessage(null);
    try {
      await updateBrandingName(value);
      setBrandingMessage({ type: 'success', text: '已更新登入畫面名稱。' });
    } catch (err) {
      const message = err.response?.data?.msg || '更新登入名稱失敗。';
      setBrandingMessage({ type: 'error', text: message });
    } finally {
      setBrandingBusy(false);
    }
  };

  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLogoBusy(true);
    setLogoMessage(null);
    try {
      await uploadBrandingLogo(file);
      setLogoMessage({ type: 'success', text: '已更新網站 Logo。' });
    } catch (err) {
      const message = err.response?.data?.msg || '上傳網站 Logo 失敗。';
      setLogoMessage({ type: 'error', text: message });
    } finally {
      setLogoBusy(false);
      event.target.value = '';
    }
  };

  const handleLogoRemove = async () => {
    if (!branding.logoUrl && !branding.logoPath) {
      setLogoMessage({ type: 'error', text: '目前沒有可移除的 Logo。' });
      return;
    }

    const confirmed = window.confirm('確定要移除目前的網站 Logo 嗎？');
    if (!confirmed) {
      return;
    }

    setLogoBusy(true);
    setLogoMessage(null);
    try {
      await removeBrandingLogo();
      setLogoMessage({ type: 'success', text: '已移除網站 Logo。' });
    } catch (err) {
      const message = err.response?.data?.msg || '移除網站 Logo 失敗。';
      setLogoMessage({ type: 'error', text: message });
    } finally {
      setLogoBusy(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!form.username.trim() || !form.password.trim()) {
      setFormError('請輸入帳號與密碼');
      return;
    }

    try {
      const payload = {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
      };
      await api.post('auth/register', payload);
      setFormSuccess('帳號建立成功。');
      setForm({ name: '', username: '', password: '', role: 'worker' });
      await loadUsers();
    } catch (err) {
      const message = err.response?.data?.msg || '建立帳號失敗。';
      setFormError(message);
    }
  };

  const handleRoleNameChange = (role, value) => {
    setRoleNameEdits((prev) => ({ ...prev, [role]: value }));
    setRoleLabelMessages((prev) => ({ ...prev, [role]: null }));
  };

  const handleRoleLabelSave = async (role) => {
    const value = (roleNameEdits[role] || '').trim();
    if (!value) {
      setRoleLabelMessages((prev) => ({
        ...prev,
        [role]: { type: 'error', text: '請輸入顯示名稱' },
      }));
      return;
    }

    setRoleLabelBusy((prev) => ({ ...prev, [role]: true }));
    setRoleLabelMessages((prev) => ({ ...prev, [role]: null }));
    try {
      await updateRoleLabel(role, value);
      setRoleLabelMessages((prev) => ({
        ...prev,
        [role]: { type: 'success', text: '已更新角色名稱。' },
      }));
    } catch (err) {
      const message = err.response?.data?.msg || '更新失敗，請稍後再試。';
      setRoleLabelMessages((prev) => ({
        ...prev,
        [role]: { type: 'error', text: message },
      }));
    } finally {
      setRoleLabelBusy((prev) => ({ ...prev, [role]: false }));
    }
  };

  const handleRoleLabelReset = async (role) => {
    setRoleLabelMessages((prev) => ({ ...prev, [role]: null }));

    if (!overrides[role]) {
      setRoleNameEdits((prev) => ({ ...prev, [role]: defaultRoleLabels[role] }));
      return;
    }

    setRoleLabelBusy((prev) => ({ ...prev, [role]: true }));
    try {
      await resetRoleLabel(role);
      setRoleLabelMessages((prev) => ({
        ...prev,
        [role]: { type: 'success', text: '已恢復預設名稱。' },
      }));
    } catch (err) {
      const message = err.response?.data?.msg || '恢復失敗，請稍後再試。';
      setRoleLabelMessages((prev) => ({
        ...prev,
        [role]: { type: 'error', text: message },
      }));
    } finally {
      setRoleLabelBusy((prev) => ({ ...prev, [role]: false }));
    }
  };

  const handleDelete = async (targetUser) => {
    if (targetUser.id === user?.id) {
      setError('無法刪除目前登入的帳號。');
      return;
    }
    const confirmed = window.confirm(`確定要刪除 ${targetUser.username} 嗎？`);
    if (!confirmed) return;

    try {
      await api.delete(`auth/users/${targetUser.id}`);
      await loadUsers();
    } catch (err) {
      const status = err.response?.status;
      if (status === 401) {
        logout();
        setError('登入資訊已失效，請重新登入。');
      } else {
        const message = err.response?.data?.msg || '刪除帳號失敗。';
        setError(message);
      }
    }
  };

  const assignedTasksText = (tasks) => {
    if (!tasks || tasks.length === 0) return '無';
    return tasks
      .map((task) => `${task.title}（${task.status}）`)
      .join('、');
  };

  const roleTotals = options.reduce((acc, option) => {
    const count = users.filter((item) => item.role === option.value).length;
    acc[option.value] = count;
    return acc;
  }, {});

  const customizedCount = Object.keys(overrides).filter((key) => overrides[key]).length;

  const adminMetrics = [
    {
      title: '總人員',
      value: userCount,
      hint: '包含所有角色帳號',
    },
    {
      title: labels.worker || defaultRoleLabels.worker,
      value: roleTotals.worker ?? 0,
      hint: '目前系統內的現場人員數量',
    },
    {
      title: labels.admin || defaultRoleLabels.admin,
      value: roleTotals.admin ?? 0,
      hint: '擁有最高權限的管理帳號',
    },
    {
      title: '自訂角色名稱',
      value: customizedCount,
      hint: '已調整顯示名稱的角色數量',
    },
  ];

  return (
    <div className="page admin-page">
      <AppHeader title="使用者管理" subtitle="建立、檢視與移除系統帳號" />
      <div className="admin-layout">
        <section className="panel panel--metrics panel--wide">
          <h2>後台概況</h2>
          <p className="panel-hint">
            快速掌握目前帳號分佈與客製化設定狀態。
          </p>
          <div className="metric-grid">
            {adminMetrics.map((metric) => (
              <div key={metric.title} className="metric-card">
                <span className="metric-card__value">{metric.value}</span>
                <span className="metric-card__title">{metric.title}</span>
                <span className="metric-card__hint">{metric.hint}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="admin-grid">
          <section className="panel panel--accent panel--wide">
            <div className="panel-header">
              <h2>品牌設定</h2>
              <span className="panel-tag">登入與後台同步更新</span>
            </div>
            <p className="panel-hint">自訂登入畫面標題與網站 Logo，將同步套用於登入頁與後台。</p>
            <div className="branding-settings">
              <div className="branding-preview">
                {branding.logoUrl ? (
                  <img src={branding.logoUrl} alt={`${branding.name} Logo`} />
                ) : (
                  <div className="branding-placeholder">尚未設定 Logo</div>
                )}
                <span className="branding-preview__name">{branding.name}</span>
              </div>
              <div className="branding-controls">
                <label>
                  登入畫面名稱
                  <input
                    value={brandingName}
                    onChange={(event) => {
                      setBrandingName(event.target.value);
                      setBrandingMessage(null);
                    }}
                    placeholder="顯示在登入畫面的標題"
                    disabled={brandingBusy || brandingLoading}
                  />
                </label>
                {brandingMessage ? (
                  <p className={brandingMessage.type === 'error' ? 'error-text' : 'success-text'}>
                    {brandingMessage.text}
                  </p>
                ) : null}
                <div className="branding-actions">
                  <button
                    type="button"
                    onClick={handleBrandingNameSave}
                    disabled={brandingBusy || brandingLoading}
                  >
                    {brandingBusy ? '儲存中…' : '儲存名稱'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setBrandingName(branding.name);
                      setBrandingMessage(null);
                    }}
                    disabled={brandingBusy || brandingLoading}
                  >
                    回復目前設定
                  </button>
                </div>
                <label className="branding-upload">
                  <span>網站 Logo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    disabled={logoBusy || brandingLoading}
                  />
                </label>
                <p className="panel-hint">建議使用透明背景 PNG 或 SVG，檔案大小請低於 5MB。</p>
                {logoMessage ? (
                  <p className={logoMessage.type === 'error' ? 'error-text' : 'success-text'}>
                    {logoMessage.text}
                  </p>
                ) : null}
                <div className="branding-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleLogoRemove}
                    disabled={
                      logoBusy || brandingLoading || (!branding.logoUrl && !branding.logoPath)
                    }
                  >
                    {logoBusy ? '處理中…' : '移除 Logo'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel--contrast">
            <div className="panel-header">
              <h2>匯出報表</h2>
              <span className="panel-tag">Excel</span>
            </div>
            <p className="panel-hint">產出任務、附件與工時的 Excel 報表。</p>
            {exportError && <p className="error-text">{exportError}</p>}
            {exportSuccess && <p className="success-text">{exportSuccess}</p>}
            <button type="button" onClick={handleExport} disabled={exporting}>
              {exporting ? '匯出中…' : '匯出任務報表'}
            </button>
          </section>

<section className="panel panel--contrast panel--wide">
  <div className="panel-header">
    <h2>信件通知設定</h2>
    <span className="panel-tag">Email</span>
  </div>
  <p className="panel-hint">
    只有在「個人設定」選擇 <strong>Email</strong> 通知的使用者會收到信件；LINE 通知不受此設定影響。
  </p>
  {emailSettingsMessage ? (
    <p className={emailSettingsMessage.type === 'error' ? 'error-text' : 'success-text'}>
      {emailSettingsMessage.text}
    </p>
  ) : null}

  <div className="stack">
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(emailSettings.enabled)}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          enabled: event.target.checked,
        }))}
        disabled={emailSettingsBusy}
      />
      <span>啟用 Email 通知</span>
    </label>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(emailSettings.send_on_assignment)}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          send_on_assignment: event.target.checked,
        }))}
        disabled={emailSettingsBusy || !emailSettings.enabled}
      />
      <span>使用者被指派任務時寄信</span>
    </label>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(emailSettings.send_on_status_change)}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          send_on_status_change: event.target.checked,
        }))}
        disabled={emailSettingsBusy || !emailSettings.enabled}
      />
      <span>任務狀態變更時寄信</span>
    </label>

    <div style={{ border: '1px solid var(--panel-border)', borderRadius: '14px', padding: '1rem', background: 'var(--panel-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <strong>狀態變更寄信條件</strong>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-button"
            onClick={setEmailStatusSelectAll}
            disabled={emailSettingsBusy || !emailSettings.enabled || !emailSettings.send_on_status_change}
          >
            全選
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={setEmailStatusAll}
            disabled={emailSettingsBusy || !emailSettings.enabled || !emailSettings.send_on_status_change}
          >
            不限（全部）
          </button>
        </div>
      </div>

      <div className="chip-list" style={{ marginTop: '0.85rem' }}>
        {emailStatusOptions.map((status) => {
          const selected = Array.isArray(emailSettings.status_targets) && emailSettings.status_targets.includes(status);
          const disabled = emailSettingsBusy || !emailSettings.enabled || !emailSettings.send_on_status_change;
          return (
            <label
              key={status}
              className="chip"
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.65 : 1,
                border: selected ? '1px solid var(--accent-color)' : '1px solid transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleEmailStatusTarget(status)}
                disabled={disabled}
                style={{ margin: 0 }}
              />
              <span>{status}</span>
            </label>
          );
        })}
      </div>

      <p className="panel-hint" style={{ marginTop: '0.75rem' }}>
        若按「不限（全部）」會在任何狀態變更時寄信；否則只在「新狀態」符合勾選項目時寄信。
      </p>
    </div>

    <label>
      信件標題前綴（選填）
      <input
        value={emailSettings.subject_prefix ?? ''}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          subject_prefix: event.target.value,
        }))}
        placeholder='例如：[Task] '
        disabled={emailSettingsBusy}
      />
    </label>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(emailSettings.include_task_link)}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          include_task_link: event.target.checked,
        }))}
        disabled={emailSettingsBusy}
      />
      <span>在信件內附上任務連結</span>
    </label>

    <label>
      任務連結 Base URL（選填）
      <input
        value={emailSettings.task_link_base_url ?? ''}
        onChange={(event) => setEmailSettings((prev) => ({
          ...prev,
          task_link_base_url: event.target.value,
        }))}
        placeholder="https://task.kuanlin.pro"
        disabled={emailSettingsBusy || !emailSettings.include_task_link}
      />
    </label>

    <button type="button" onClick={saveEmailSettings} disabled={emailSettingsBusy}>
      {emailSettingsBusy ? '儲存中…' : '儲存信件設定'}
    </button>
  </div>
</section>

<section className="panel panel--contrast panel--wide">
  <div className="panel-header">
    <h2>LINE 通知設定</h2>
    <span className="panel-tag">LINE</span>
  </div>
  <p className="panel-hint">
    只有在「個人設定」選擇 <strong>LINE</strong> 通知且完成綁定的使用者會收到推播通知。
    {lineHasBot ? null : (
      <> <strong>提醒：</strong>後端尚未偵測到 LINE Bot 設定（請確認 Zeabur Variables 有 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET）。</>
    )}
  </p>

  {lineSettingsMessage ? (
    <p className={lineSettingsMessage.type === 'error' ? 'error-text' : 'success-text'}>
      {lineSettingsMessage.text}
    </p>
  ) : null}

  <div className="stack">
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(lineSettings.enabled)}
        onChange={(event) => setLineSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
        disabled={lineSettingsBusy}
      />
      <span>啟用 LINE 通知</span>
    </label>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(lineSettings.send_on_assignment)}
        onChange={(event) => setLineSettings((prev) => ({ ...prev, send_on_assignment: event.target.checked }))}
        disabled={lineSettingsBusy || !lineSettings.enabled}
      />
      <span>使用者被指派任務時推播</span>
    </label>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(lineSettings.send_on_status_change)}
        onChange={(event) => setLineSettings((prev) => ({ ...prev, send_on_status_change: event.target.checked }))}
        disabled={lineSettingsBusy || !lineSettings.enabled}
      />
      <span>任務狀態變更時推播</span>
    </label>

    <div style={{ border: '1px solid var(--panel-border)', borderRadius: '14px', padding: '1rem', background: 'var(--panel-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <strong>狀態變更推播條件</strong>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-button"
            onClick={setLineStatusSelectAll}
            disabled={lineSettingsBusy || !lineSettings.enabled || !lineSettings.send_on_status_change}
          >
            全選
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={setLineStatusAll}
            disabled={lineSettingsBusy || !lineSettings.enabled || !lineSettings.send_on_status_change}
          >
            不限（全部）
          </button>
        </div>
      </div>

      <div className="chip-list" style={{ marginTop: '0.85rem' }}>
        {lineStatusOptions.map((status) => {
          const selected = Array.isArray(lineSettings.status_targets) && lineSettings.status_targets.includes(status);
          const disabled = lineSettingsBusy || !lineSettings.enabled || !lineSettings.send_on_status_change;
          return (
            <label
              key={status}
              className="chip"
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.65 : 1,
                border: selected ? '1px solid var(--accent-color)' : '1px solid transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleLineStatusTarget(status)}
                disabled={disabled}
                style={{ margin: 0 }}
              />
              <span>{status}</span>
            </label>
          );
        })}
      </div>

      <p className="panel-hint" style={{ marginTop: '0.75rem' }}>
        若按「不限（全部）」會在任何狀態變更時推播；否則只在「新狀態」符合勾選項目時推播。
      </p>
    </div>

    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600 }}>
      <input
        type="checkbox"
        checked={Boolean(lineSettings.include_task_link)}
        onChange={(event) => setLineSettings((prev) => ({ ...prev, include_task_link: event.target.checked }))}
        disabled={lineSettingsBusy}
      />
      <span>在 LINE 訊息內附上任務連結</span>
    </label>

    <label>
      任務連結 Base URL（選填）
      <input
        value={lineSettings.task_link_base_url ?? ''}
        onChange={(event) => setLineSettings((prev) => ({ ...prev, task_link_base_url: event.target.value }))}
        placeholder="https://task.kuanlin.pro"
        disabled={lineSettingsBusy || !lineSettings.include_task_link}
      />
    </label>

    <button type="button" onClick={saveLineSettings} disabled={lineSettingsBusy}>
      {lineSettingsBusy ? '儲存中…' : '儲存 LINE 設定'}
    </button>
  </div>
</section>


          <section className="panel panel--contrast">
            <div className="panel-header">
              <h2>新增帳號</h2>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setForm((prev) => ({ ...prev, role: 'worker' }))}
              >
                一鍵選擇{workerLabel}
              </button>
            </div>
            <p className="panel-hint">
              快速建立{workerLabel}帳號時預設角色為{workerLabel}，其餘角色請自行選擇。
            </p>
            {formError && <p className="error-text">{formError}</p>}
            {formSuccess && <p className="success-text">{formSuccess}</p>}
            <form className="stack" onSubmit={handleSubmit}>
              <label>
                名稱（選填）
                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  placeholder="可輸入人員顯示名稱"
                />
              </label>
              <label>
                帳號
                <input
                  name="username"
                  value={form.username}
                  onChange={handleFormChange}
                  placeholder="登入帳號"
                  required
                />
              </label>
              <label>
                密碼
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleFormChange}
                  placeholder="設定登入密碼"
                  required
                />
              </label>
              <label>
                角色
                <select name="role" value={form.role} onChange={handleFormChange}>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">建立帳號</button>
            </form>
          </section>

          <section className="panel panel--contrast panel--wide">
            <div className="panel-header">
              <h2>角色顯示名稱</h2>
              <span className="panel-tag">顯示調整</span>
            </div>
            <p className="panel-hint">自訂角色在系統中顯示的名稱，例如將「工人」改為「水電工」。</p>
            <div className="role-label-list">
              {options.map((option) => {
                const role = option.value;
                const busy = Boolean(roleLabelBusy[role]);
                const feedback = roleLabelMessages[role];
                const currentValue = roleNameEdits[role] ?? '';
                const isCustomized = Boolean(overrides[role]);

                return (
                  <div key={role} className="role-label-item">
                    <div className="role-label-item__meta">
                      <span>
                        預設名稱：
                        <strong>{defaultRoleLabels[role]}</strong>
                      </span>
                      {isCustomized ? <span className="role-label-tag">已自訂</span> : null}
                    </div>
                    <label>
                      顯示名稱
                      <input
                        value={currentValue}
                        onChange={(event) => handleRoleNameChange(role, event.target.value)}
                        placeholder="輸入顯示名稱"
                        disabled={busy}
                      />
                    </label>
                    {feedback ? (
                      <p className={feedback.type === 'error' ? 'error-text' : 'success-text'}>
                        {feedback.text}
                      </p>
                    ) : null}
                    <div className="role-label-item__actions">
                      <button type="button" onClick={() => handleRoleLabelSave(role)} disabled={busy}>
                        {busy ? '儲存中…' : '儲存變更'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleRoleLabelReset(role)}
                        disabled={busy || (!isCustomized && currentValue === defaultRoleLabels[role])}
                      >
                        恢復預設
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="panel panel--wide panel--table">
          <div className="panel-header">
            <h2>使用者清單（{userCount}）</h2>
            <span className="panel-tag">帳號管理</span>
          </div>
          {error && <p className="error-text">{error}</p>}
          {loading ? (
            <p>載入中...</p>
          ) : users.length === 0 ? (
            <p>目前沒有其他使用者。</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>帳號</th>
                    <th>角色</th>
                    <th>指派任務</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.username}</td>
                      <td>{labels[item.role] || item.role}</td>
                      <td>{assignedTasksText(item.assigned_tasks)}</td>
                      <td>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDelete(item)}
                        >
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminPage;
