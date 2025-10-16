import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const statusOptions = [
  { value: 'pending', label: '待處理' },
  { value: 'in_progress', label: '處理中' },
  { value: 'on_hold', label: '暫停' },
  { value: 'completed', label: '已完成' },
];

const attachmentTypes = [
  { value: 'image', label: '圖片' },
  { value: 'audio', label: '語音' },
  { value: 'signature', label: '簽名' },
  { value: 'other', label: '其他' },
];

const TaskDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [updateForm, setUpdateForm] = useState({ status: '', note: '' });
  const [fileForm, setFileForm] = useState({ file: null, file_type: 'image', note: '' });
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadTask();
  }, [id]);

  const handleUpdateChange = (event) => {
    const { name, value } = event.target;
    setUpdateForm((prev) => ({ ...prev, [name]: value }));
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
      <header className="page-header">
        <h1>{task.title}</h1>
        <div className="header-actions">
          <Link to="/">返回列表</Link>
        </div>
      </header>
      {error && <p className="error-text">{error}</p>}
      <section className="panel">
        <h2>任務資訊</h2>
        <p>狀態：{task.status}</p>
        <p>指派給：{task.assigned_to || '未指派'}</p>
        <p>建立人：{task.assigned_by || '系統'}</p>
        <p>內容：{task.description || '沒有描述'}</p>
        {task.due_date && <p>截止日期：{new Date(task.due_date).toLocaleString()}</p>}
      </section>

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
