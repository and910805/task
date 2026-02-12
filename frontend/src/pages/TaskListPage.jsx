import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const statusOptions = [
  { value: 'Â∞öÊú™?•ÂñÆ', label: 'Â∞öÊú™?•ÂñÆ' },
  { value: 'Â∑≤Êé•??, label: 'Â∑≤Êé•?? },
  { value: '?≤Ë?‰∏?, label: '?≤Ë?‰∏? },
  { value: 'Â∑≤Â???, label: 'Â∑≤Â??? },
];

const initialForm = {
  title: '',
  description: '',
  location: '',
  location_url: '',
  expected_time: '',
  status: 'Â∞öÊú™?•ÂñÆ',
  assignee_ids: [],
};

const statusFilterOptions = [
  { value: 'all', label: '?®ÈÉ®‰ªªÂ?' },
  ...statusOptions,
];

const sortOptions = [
  { value: 'due_soon', label: '?ÄËøëÊà™Ê≠? },
  { value: 'created_desc', label: '?Ä?∞Âª∫Á´? },
];

const TaskListPage = () => {
  const { user } = useAuth();
  const { labels } = useRoleLabels();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [siteLocations, setSiteLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');
  const [sortOption, setSortOption] = useState('due_soon');
  const [assigningTaskId, setAssigningTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);
  const hasNotificationPreference = user?.notification_type && user?.notification_type !== 'none';
  const [showOverdue, setShowOverdue] = useState(Boolean(hasNotificationPreference));

  const isManager = managerRoles.has(user?.role);
  const isWorker = user?.role === 'worker';

  const getErrorMessage = (err, fallback) =>
    err?.networkMessage || err?.response?.data?.msg || fallback;

  const assigneeOptions = useMemo(
    () =>
      users.map((item) => ({
        value: item.id,
        label: `${item.username}Ôº?{labels[item.role] || item.role}Ôºâ`,
      })),
    [users, labels],
  );

  const locationOptions = useMemo(
    () =>
      siteLocations.map((location) => ({
        value: location.name,
        label: location.name,
        map_url: location.map_url || null,
      })),
    [siteLocations],
  );

  const selectedLocation = useMemo(() => {
    if (!form.location) return null;
    return (
      locationOptions.find((option) => option.value === form.location) || {
        value: form.location,
        label: form.location,
      }
    );
  }, [form.location, locationOptions]);

  const loadTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    setError('');
    try {
      const { data } = await api.get('tasks/');
      setTasks(data);
    } catch (err) {
      const message = getErrorMessage(err, '?°Ê??ñÂ?‰ªªÂ??óË°®??);
      setError(message);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const loadAvailableTasks = async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoadingAvailable(true);
    }
    try {
      const { data } = await api.get('tasks/', { params: { available: 1 } });
      setAvailableTasks(data);
    } catch (err) {
      const message = getErrorMessage(err, '?°Ê??ñÂ??ØÊé•?Æ‰ªª?ô„Ä?);
      setError(message);
    } finally {
      if (showLoading) {
        setLoadingAvailable(false);
      }
    }
  };

  const loadUsers = async () => {
    if (!isManager) return;
    try {
      const { data } = await api.get('auth/assignable-users');
      setUsers(data);
    } catch (err) {
      console.error('?°Ê??ñÂ?‰ΩøÁî®?ÖÂ?Ë°?, err);
    }
  };

  const loadSiteLocations = async () => {
    if (!isManager) return;
    setLoadingLocations(true);
    try {
      const { data } = await api.get('site-locations');
      const list = Array.isArray(data) ? data : data?.locations ?? [];
      setSiteLocations(list);
    } catch (err) {
      console.error('?°Ê??ñÂ?Â∏∏Áî®?∞È?', err);
    } finally {
      setLoadingLocations(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (availableOnly) {
      loadAvailableTasks();
    }
  }, [availableOnly]);

  useEffect(() => {
    loadUsers();
  }, [isManager]);

  useEffect(() => {
    loadSiteLocations();
  }, [isManager]);

  useEffect(() => {
    setShowOverdue(Boolean(hasNotificationPreference));
  }, [hasNotificationPreference]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError('');
    const trimmedTitle = form.title.trim();
    const trimmedDescription = form.description.trim();
    const trimmedLocation = form.location.trim();
    const trimmedLocationUrl = form.location_url.trim();

    if (!trimmedTitle || !trimmedDescription || !trimmedLocation || !form.expected_time) {
      setError('Ë´ãÂ??¥Â°´ÂØ´‰ªª?ôÂ?Á®±„ÄÅÂú∞Èªû„ÄÅÊ?Ëø∞Ë??êË?ÂÆåÊ??ÇÈ???);
      return;
    }

    const expectedDate = new Date(form.expected_time);
    if (Number.isNaN(expectedDate.getTime())) {
      setError('?êË?ÂÆåÊ??ÇÈ??ºÂ?‰∏çÊ≠£Á¢∫„Ä?);
      return;
    }

    try {
      const payload = {
        title: trimmedTitle,
        description: trimmedDescription,
        location: trimmedLocation,
        location_url: trimmedLocationUrl || null,
        expected_time: expectedDate.toISOString(),
        status: form.status,
        assignee_ids: form.assignee_ids.map(Number),
      };
      await api.post('tasks/create', payload);
      setForm({ ...initialForm });
      setCreating(false);
      await loadTasks();
    } catch (err) {
      const message = getErrorMessage(err, 'Âª∫Á?‰ªªÂ?Â§±Ê???);
      setError(message);
    }
  };

  const handleStatusChange = async (taskId, nextStatus) => {
    setError('');
    try {
      await api.patch(`tasks/update/${taskId}`, { status: nextStatus });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '?¥Êñ∞‰ªªÂ??Ä?ãÂ§±?ó„Ä?);
      setError(message);
    }
  };

  const handleAssigneesChange = async (taskId, values) => {
    setError('');
    setAssigningTaskId(taskId);
    try {
      await api.patch(`tasks/update/${taskId}`, { assignee_ids: values });
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '?¥Êñ∞?áÊ¥æÂ∞çË±°Â§±Ê???);
      setError(message);
    } finally {
      setAssigningTaskId(null);
    }
  };

  const handleRefresh = async () => {
    setError('');
    setRefreshing(true);
    try {
      await loadTasks({ showLoading: false });
      if (availableOnly) {
        await loadAvailableTasks({ showLoading: false });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleAcceptTask = async (taskId) => {
    setError('');
    setAcceptingTaskId(taskId);
    try {
      await api.post(`tasks/${taskId}/accept`);
      await loadTasks({ showLoading: false });
      if (availableOnly) {
        await loadAvailableTasks({ showLoading: false });
      }
    } catch (err) {
      const message = getErrorMessage(err, '?•ÂñÆÂ§±Ê???);
      setError(message);
    } finally {
      setAcceptingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId, taskTitle) => {
    const confirmed = window.confirm(`Á¢∫Â?Ë¶ÅÂà™?§„Ä?{taskTitle}?ç‰ªª?ôÂ?Ôºü`);
    if (!confirmed) {
      return;
    }

    setError('');
    setDeletingTaskId(taskId);
    try {
      await api.delete(`tasks/${taskId}`);
      await loadTasks({ showLoading: false });
    } catch (err) {
      const message = getErrorMessage(err, '?™Èô§‰ªªÂ?Â§±Ê???);
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const filteredTasks = useMemo(() => {
    const locationQuery = locationFilter.trim().toLowerCase();
    let result = availableOnly ? availableTasks : tasks;

    if (statusFilter !== 'all') {
      result = result.filter((task) => task.status === statusFilter);
    }

    if (locationQuery) {
      result = result.filter((task) =>
        (task.location || '').toLowerCase().includes(locationQuery),
      );
    }

    const getDueTimestamp = (task) => {
      const rawDate = task.due_date || task.expected_time;
      if (!rawDate) return Number.POSITIVE_INFINITY;
      const parsed = new Date(rawDate).getTime();
      return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
    };

    const getCreatedTimestamp = (task) => {
      if (!task.created_at) return 0;
      const parsed = new Date(task.created_at).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const sorted = [...result].sort((a, b) => {
      if (sortOption === 'created_desc') {
        return getCreatedTimestamp(b) - getCreatedTimestamp(a);
      }
      return getDueTimestamp(a) - getDueTimestamp(b);
    });

    return sorted;
  }, [
    availableOnly,
    availableTasks,
    locationFilter,
    sortOption,
    statusFilter,
    tasks,
  ]);

  const toolbarFilters = (
    <>
      <label>
        ?∞È??úÂ?
        <input
          type="search"
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          placeholder="Ëº∏ÂÖ•?∞È??úÈçµÂ≠?
        />
      </label>
      <label>
        ?íÂ??πÂ?
        <select
          value={sortOption}
          onChange={(event) => setSortOption(event.target.value)}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const statusBadgeClass = {
    Â∞öÊú™?•ÂñÆ: 'status-badge status-pending',
    Â∑≤Êé•?? 'status-badge status-in-progress',
    ?≤Ë?‰∏? 'status-badge status-in-progress',
    Â∑≤Â??? 'status-badge status-completed',
  };

  const headerActions = isManager ? (
    <div className="task-toolbar">
      <label>
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => setAvailableOnly(event.target.checked)}
        />
        ?™È°ØÁ§∫ÂèØ?•ÂñÆ
      </label>
      <label>
        <input
          type="checkbox"
          checked={showOverdue}
          onChange={(event) => setShowOverdue(event.target.checked)}
        />
        È°ØÁ§∫?æÊ??êÈ?
      </label>
      <label>
        È°ØÁ§∫?Ä??
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          {statusFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {toolbarFilters}
    </div>
  ) : (
    <div className="task-toolbar">
      <label>
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => setAvailableOnly(event.target.checked)}
        />
        ?™È°ØÁ§∫ÂèØ?•ÂñÆ
      </label>
      <label>
        <input
          type="checkbox"
          checked={showOverdue}
          onChange={(event) => setShowOverdue(event.target.checked)}
        />
        È°ØÁ§∫?æÊ??êÈ?
      </label>
      {toolbarFilters}
      <button
        type="button"
        className="secondary-button"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? '?∑Êñ∞‰∏≠‚Ä? : '?? ?∑Êñ∞‰ªªÂ?'}
      </button>
    </div>
  );

  const emptyStateMessage =
    availableOnly
      ? '?ÆÂ?Ê≤íÊ??ØÊé•?Æ‰ªª?ô„Ä?
      : statusFilter === 'all'
      ? '?ÆÂ?Ê≤íÊ?‰ªªÂ???
      : 'Ê≠§Á??ãÊ??âÁ¨¶?àÁ?‰ªªÂ???;

  return (
    <div className="page">
      <AppHeader
        title="‰ªªÂ?ÁÆ°Á??¢Êùø"
        subtitle="Ê™¢Ë??áÊ?Ê¥æ‰ªª??
        actions={headerActions}
      />
      {isManager && (
        <section className="panel">
          <button type="button" onClick={() => setCreating((prev) => !prev)}>
            {creating ? '?úÈ?Âª∫Á?Ë°®ÂñÆ' : '?∞Â?‰ªªÂ?'}
          </button>
          {creating && (
            <form className="stack" onSubmit={handleCreate}>
              <label>
                ‰ªªÂ??çÁ®±
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="Ëº∏ÂÖ•‰ªªÂ??çÁ®±"
                  required
                />
              </label>
              <label>
                ‰ªªÂ??èËø∞
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="?èËø∞‰ªªÂ??ßÂÆπ"
                  required
                />
              </label>
              <label>
                ‰ªªÂ??∞È?
                <CreatableSelect
                  classNamePrefix="location-select"
                  placeholder="?∏Ê??ñÊ?Â∞ãÂ∏∏?®Âú∞Èª?
                  options={locationOptions}
                  value={selectedLocation}
                  isClearable
                  isSearchable
                  isLoading={loadingLocations}
                  formatCreateLabel={(value) => `?∞Â???{value}?ç`}
                  noOptionsMessage={() => 'Ê≤íÊ?Á¨¶Â??ÑÂú∞Èª?}
                  onChange={(option) =>
                    setForm((prev) => ({ ...prev, location: option?.value || '' }))
                  }
                  onCreateOption={(inputValue) =>
                    setForm((prev) => ({ ...prev, location: inputValue }))
                  }
                />
                {selectedLocation?.map_url ? (
                  <a
                    href={selectedLocation.map_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-link"
                  >
                    ?•Á? Google Maps
                  </a>
                ) : null}
              </label>
              <label>
                ?∞Â????
                <input
                  type="url"
                  name="location_url"
                  value={form.location_url}
                  onChange={handleChange}
                  placeholder="?ØË≤º‰∏?Google ?∞Â????"
                />
              </label>
              <label>
                ?∞Â????
                <input
                  type="url"
                  name="location_url"
                  value={form.location_url}
                  onChange={handleChange}
                  placeholder="?ØË≤º‰∏?Google ?∞Â????"
                />
              </label>
              <label>
                ?êË?ÂÆåÊ??ÇÈ?
                <input
                  type="datetime-local"
                  name="expected_time"
                  value={form.expected_time}
                  onChange={handleChange}
                  required
                />
              </label>
              <label>
                ‰ªªÂ??≤Â∫¶
                <select name="status" value={form.status} onChange={handleChange}>
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {isManager ? (
                <label>
                  ?áÊ¥æÁµ?
                  <Select
                    isMulti
                    classNamePrefix="assignee-select"
                    placeholder="?∏Ê?Ë≤†Ë≤¨‰∫∫Ô??ØË??∏Ô?"
                    options={assigneeOptions}
                    value={assigneeOptions.filter((option) =>
                      form.assignee_ids.includes(option.value),
                    )}
                    onChange={(selected) =>
                      setForm((prev) => ({
                        ...prev,
                        assignee_ids: (selected || []).map((option) => option.value),
                      }))
                    }
                    isClearable
                    closeMenuOnSelect={false}
                  />
                </label>
              ) : null}
              <button type="submit">Âª∫Á?‰ªªÂ?</button>
            </form>
          )}
        </section>
      )}
      {error && (
        <div className="error-text" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={handleRefresh}>
            ?çË©¶
          </button>
        </div>
      )}
      <section className="panel">
        <h2>‰ªªÂ??óË°®</h2>
        {loading || (availableOnly && loadingAvailable) ? (
          <p>ËºâÂÖ•‰∏?..</p>
        ) : filteredTasks.length === 0 ? (
          <p>{emptyStateMessage}</p>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const taskAssigneeIds = task.assignee_ids || [];
              const assignedUsers = task.assignees || [];
              const selectValue = assigneeOptions.filter((option) =>
                taskAssigneeIds.includes(option.value),
              );
              const isOverdue =
                task.is_overdue ||
                (task.due_date &&
                  task.status !== 'Â∑≤Â??? &&
                  new Date(task.due_date).getTime() < Date.now());
              const showOverdueIndicator = showOverdue && isOverdue;
              const canAccept =
                isWorker && task.status === 'Â∞öÊú™?•ÂñÆ' && !task.assigned_to_id;
              const hasMissingAssignee =
                isManager &&
                taskAssigneeIds.length > 0 &&
                selectValue.length !== taskAssigneeIds.length;
              const dueDateLabel = task.due_date || task.expected_time;
              const dueDateText = dueDateLabel
                ? new Date(dueDateLabel).toLocaleString()
                : '?™Ë®≠ÂÆ?;
              return (
                <li
                  key={task.id}
                  className={`task-item${showOverdueIndicator ? ' task-overdue' : ''}`}
                >
                  <div className="task-card">
                    <div className="task-card__header">
                      <h3>
                        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                      </h3>
                      <div className="task-card__status">
                        <span className={statusBadgeClass[task.status] || 'status-badge'}>
                          ??{task.status}
                        </span>
                        {showOverdueIndicator && (
                          <span className="status-badge status-overdue">?†Ô? ?æÊ?</span>
                        )}
                      </div>
                    </div>
                    <div className="task-card__meta">
                      <span>?∞È?Ôºö{task.location}</span>
                      <span>?™Ê≠¢?•Ê?Ôºö{dueDateText}</span>
                    </div>
                    <div className="task-card__cta">
                      {isManager ? (
                        <select
                          value={task.status}
                          onChange={(event) =>
                            handleStatusChange(task.id, event.target.value)
                          }
                        >
                          {statusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : canAccept ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleAcceptTask(task.id)}
                          disabled={acceptingTaskId === task.id}
                        >
                          {acceptingTaskId === task.id ? '?•ÂñÆ‰∏≠‚Ä? : '?•ÂñÆ'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="task-details">
                    <h3 className="task-title">
                      <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                    </h3>
                    <p className="task-secondary">{task.description || 'Ê≤íÊ??èËø∞'}</p>
                    <p className="task-secondary">?∞È?Ôºö{task.location}</p>
                    <p className="task-secondary">
                      ?êË?ÂÆåÊ?Ôº?
                      {task.expected_time
                        ? new Date(task.expected_time).toLocaleString()
                        : '?™Ë®≠ÂÆ?}
                    </p>
                    <p className="task-secondary">
                      Á∏ΩÂ∑•?ÇÔ?{(task.total_work_hours ?? 0).toFixed(2)} Â∞èÊ?
                    </p>
                    <p className="task-status-row">
                      ‰ªªÂ??≤Â∫¶Ôº?
                      {isManager ? (
                        <span className="task-status-control">
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ??{task.status}
                          </span>
                          {showOverdueIndicator && (
                            <span className="status-badge status-overdue">?†Ô? ?æÊ?</span>
                          )}
                          <select
                            value={task.status}
                            onChange={(event) =>
                              handleStatusChange(task.id, event.target.value)
                            }
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        <>
                          <span className={statusBadgeClass[task.status] || 'status-badge'}>
                            ??{task.status}
                          </span>
                          {showOverdueIndicator && (
                            <span className="status-badge status-overdue">?†Ô? ?æÊ?</span>
                          )}
                          {canAccept && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleAcceptTask(task.id)}
                              disabled={acceptingTaskId === task.id}
                            >
                              {acceptingTaskId === task.id ? '?•ÂñÆ‰∏≠‚Ä? : '?•ÂñÆ'}
                            </button>
                          )}
                        </>
                      )}
                    </p>
                    <div>
                      <strong>?áÊ¥æÂ∞çË±°Ôº?/strong>
                      {assignedUsers.length > 0 ? (
                        <div className="chip-list">
                          {assignedUsers.map((assignee) => (
                            <span key={assignee.id} className="chip">
                              {assignee.username}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="hint-text">?™Ê?Ê¥?/span>
                      )}
                      {hasMissingAssignee ? (
                        <p className="error-text">?®Â??áÊ¥æÂ∞çË±°Â∑≤Ë¢´ÁßªÈô§</p>
                      ) : null}
                    </div>
                    {isManager && (
                      <div className="task-actions">
                        <div className="task-toolbar">
                          <div className="task-assignee-select">
                            <Select
                              isMulti
                              classNamePrefix="assignee-select"
                              placeholder="?∏Ê?Ë≤†Ë≤¨‰∫?
                              options={assigneeOptions}
                              value={selectValue}
                              onChange={(selected) =>
                                handleAssigneesChange(
                                  task.id,
                                  (selected || []).map((option) => option.value),
                                )
                              }
                              isDisabled={assigningTaskId === task.id}
                              isLoading={assigningTaskId === task.id}
                              closeMenuOnSelect={false}
                            />
                          </div>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDeleteTask(task.id, task.title)}
                            disabled={deletingTaskId === task.id}
                          >
                            {deletingTaskId === task.id ? '?™Èô§‰∏≠‚Ä? : '?™Èô§‰ªªÂ?'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default TaskListPage;

