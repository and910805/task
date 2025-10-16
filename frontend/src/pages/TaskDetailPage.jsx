import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import { managerRoles, roleLabels } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';

const statusOptions = [
  { value: '尚未接單', label: '尚未接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const attachmentTypes = [
  { value: 'image', label: '圖片' },
  { value: 'audio', label: '語音' },
  { value: 'signature', label: '簽名' },
  { value: 'other', label: '其他' },
];

const toInputDatetimeValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offsetInMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetInMs);
  return local.toISOString().slice(0, 16);
};

const TaskDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentSuccess, setAssignmentSuccess] = useState('');
  const [updateForm, setUpdateForm] = useState({ status: '', note: '' });
  const [fileForm, setFileForm] = useState({ file: null, file_type: 'image', note: '' });
  const [loading, setLoading] = useState(true);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    assigned_to_id: '',
    due_date: '',
  });

  const isManager = useMemo(() => managerRoles.has(user?.role), [user?.role]);

  const loadTask = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/tasks/${id}`);
      setTask(data);
    } catch (err) {
      const message = err.response?.data?.msg || '找不到該任務。';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadAssignableUsers = async () => {
    if (!isManager) return;
    try {
      const { data } = await api.get('/auth/assignable-users');
      setAssignableUsers(data);
    } catch (err) {
      console.error('無法取得可指派使用者列表', err);
    }
  };

  useEffect(() => {
    loadTask();
  }, [id]);

  useEffect(() => {
    if (isManager) {
      loadAssignableUsers();
    }
  }, [isManager]);

  useEffect(() => {
    if (!task) return;
    setAssignmentForm({
      assigned_to_id: task.assigned_to_id ? String(task.assigned_to_id) : '',
      due_date: task.due_date ? toInputDatetimeValue(task.due_date) : '',
    });
  }, [task]);

  const handleUpdateChange = (event) => {
    const { name, value } = event.target;
    setUpdateForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAssignmentChange = (event) => {
    const { name, value } = event.target;
    setAssignmentForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleStatusSubmit = async (event) => {
    event.preventDefault();
    if (!updateForm.status && !updateForm.note) return;
    try {
      const payload = {
        status: updateForm.status || undefined,
        note: updateForm.note || undefined,
      };
      await api.post(`/tasks/${id}/updates`, payload);
      setUpdateForm({ status: '', note: '' });
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '更新狀態失敗。';
      setError(message);
    }
  };

  const handleAssignmentSubmit = async (event) => {
    event.preventDefault();
    setAssignmentError('');
    setAssignmentSuccess('');
    try {
      const payload = {
        assigned_to_id: assignmentForm.assigned_to_id
          ? Number(assignmentForm.assigned_to_id)
          : null,
        due_date: assignmentForm.due_date,
      };
      await api.put(`/tasks/${id}`, payload);
      setAssignmentSuccess('任務指派資訊已更新。');
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '更新任務指派失敗。';
      setAssignmentError(message);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setFileForm((prev) => ({ ...prev, file }));
  };

  const handleFileMetaChange = (event) => {
    const { name, value } = event.target;
    setFileForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!fileForm.file) return;
    const formData = new FormData();
    formData.append('file', fileForm.file);
    formData.append('file_type', fileForm.file_type);
    if (fileForm.note) {
      formData.append('note', fileForm.note);
    }
    try {
      await api.post(`/tasks/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFileForm({ file: null, file_type: 'image', note: '' });
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '上傳檔案失敗。';
      setError(message);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <p>載入中...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="page">
        <p>{error || '無法顯示任務。'}</p>
        <button type="button" onClick={() => navigate(-1)}>
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <AppHeader title={task.title} subtitle={`任務編號：${task.id}`}>
        <Link to="/" className="link-button">
          ← 返回任務列表
        </Link>
      </AppHeader>
      {error && <p className="error-text">{error}</p>}
      <section className="panel">
        <h2>任務資訊</h2>
        <p>狀態：{task.status}</p>
        <p>指派給：{task.assigned_to || '未指派'}</p>
        <p>建立人：{task.assigned_by || '系統'}</p>
        <p>內容：{task.description || '沒有描述'}</p>
        <p>地點：{task.location}</p>
        <p>預計完成時間：{task.expected_time ? new Date(task.expected_time).toLocaleString() : '未設定'}</p>
        {task.completed_at && <p>實際完成時間：{new Date(task.completed_at).toLocaleString()}</p>}
        {task.due_date && <p>截止日期：{new Date(task.due_date).toLocaleString()}</p>}
      </section>

      {isManager && (
        <section className="panel">
          <h2>指派設定</h2>
          {assignmentError && <p className="error-text">{assignmentError}</p>}
          {assignmentSuccess && <p className="success-text">{assignmentSuccess}</p>}
          <form className="stack" onSubmit={handleAssignmentSubmit}>
            <label>
              指派給
              <select
                name="assigned_to_id"
                value={assignmentForm.assigned_to_id}
                onChange={handleAssignmentChange}
              >
                <option value="">未指派</option>
                {assignableUsers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.username}（{roleLabels[option.role] || option.role}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              截止時間
              <input
                type="datetime-local"
                name="due_date"
                value={assignmentForm.due_date}
                onChange={handleAssignmentChange}
              />
            </label>
            <button type="submit">儲存指派</button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>狀態更新與回報</h2>
        {task.updates.length === 0 ? (
          <p>尚無回報。</p>
        ) : (
          <ul className="updates">
            {task.updates.map((update) => (
              <li key={update.id}>
                <p>
                  <strong>{update.author || '系統'}</strong> - {new Date(update.created_at).toLocaleString()}
                </p>
                {update.status && <p>狀態：{update.status}</p>}
                {update.note && <p>備註：{update.note}</p>}
              </li>
            ))}
          </ul>
        )}
        <form className="stack" onSubmit={handleStatusSubmit}>
          <label>
            狀態
            <select name="status" value={updateForm.status} onChange={handleUpdateChange}>
              <option value="">選擇狀態</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            備註
            <textarea
              name="note"
              value={updateForm.note}
              onChange={handleUpdateChange}
              placeholder="填寫回報內容"
            />
          </label>
          <button type="submit">送出回報</button>
        </form>
      </section>

      <section className="panel">
        <h2>附件</h2>
        {task.attachments.length === 0 ? (
          <p>尚未上傳附件。</p>
        ) : (
          <ul className="attachments">
            {task.attachments.map((attachment) => (
              <li key={attachment.id}>
                <p>
                  <strong>{attachment.file_type}</strong> - {attachment.original_name}
                </p>
                {attachment.note && <p>說明：{attachment.note}</p>}
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  下載檔案
                </a>
              </li>
            ))}
          </ul>
        )}
        <form className="stack" onSubmit={handleUpload}>
          <label>
            檔案類型
            <select name="file_type" value={fileForm.file_type} onChange={handleFileMetaChange}>
              {attachmentTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            附件說明
            <input
              name="note"
              value={fileForm.note}
              onChange={handleFileMetaChange}
              placeholder="可填寫補充說明"
            />
          </label>
          <label>
            選擇檔案
            <input type="file" onChange={handleFileChange} accept="image/*,audio/*" />
          </label>
          <button type="submit" disabled={!fileForm.file}>
            上傳附件
          </button>
        </form>
      </section>
    </div>
  );
};

export default TaskDetailPage;
