import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import AudioRecorder from '../components/task/AudioRecorder.jsx';
import SignaturePad from '../components/task/SignaturePad.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const statusOptions = [
  { value: '尚未接單', label: '尚未接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const detailTabs = [
  { key: 'info', label: 'ℹ️ 任務資訊' },
  { key: 'photos', label: '📷 照片' },
  { key: 'audio', label: '🎤 語音' },
  { key: 'signature', label: '✍️ 簽名' },
  { key: 'time', label: '⏱ 工時' },
];

const toInputDatetimeValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offsetInMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetInMs);
  return local.toISOString().slice(0, 16);
};

const formatDateTime = (value) => {
  if (!value) return '未設定';
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    return value;
  }
};

const formatHours = (hours) => Number(hours ?? 0).toFixed(2);

const TaskDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { labels } = useRoleLabels();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentSuccess, setAssignmentSuccess] = useState('');
  const [updateForm, setUpdateForm] = useState({ status: '', note: '' });
  const [loading, setLoading] = useState(true);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    assigned_to_id: '',
    due_date: '',
  });
  const [activeTab, setActiveTab] = useState('info');
  const [photoForm, setPhotoForm] = useState({ file: null, note: '' });
  const [audioForm, setAudioForm] = useState({ file: null, note: '', transcript: '' });
  const [signatureNote, setSignatureNote] = useState('');
  const [timeMessage, setTimeMessage] = useState('');
  const [timeError, setTimeError] = useState('');
  const [timeLoading, setTimeLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState('');
  const audioFileInputRef = useRef(null);

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

  const buildAttachmentUrl = useCallback(
    (url) => {
      if (!url) return url;
      if (/^https?:\/\//i.test(url)) {
        return url;
      }
      if (!token) {
        return url;
      }
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}token=${encodeURIComponent(token)}`;
    },
    [token],
  );

  const resolvedAttachments = useMemo(
    () =>
      (task?.attachments ?? []).map((item) => ({
        ...item,
        url: buildAttachmentUrl(item.url),
      })),
    [task, buildAttachmentUrl],
  );

  const photoAttachments = useMemo(
    () => resolvedAttachments.filter((item) => item.file_type === 'image'),
    [resolvedAttachments],
  );
  const audioAttachments = useMemo(
    () => resolvedAttachments.filter((item) => item.file_type === 'audio'),
    [resolvedAttachments],
  );
  const signatureAttachment = useMemo(
    () => resolvedAttachments.find((item) => item.file_type === 'signature') || null,
    [resolvedAttachments],
  );
  const timeEntries = useMemo(() => task?.time_entries ?? [], [task]);
  const activeEntry = useMemo(
    () => timeEntries.find((entry) => entry.user_id === user?.id && !entry.end_time) || null,
    [timeEntries, user?.id],
  );

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

  const handlePhotoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setPhotoForm((prev) => ({ ...prev, file }));
  };

  const handlePhotoUpload = async (event) => {
    event.preventDefault();
    if (!photoForm.file) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', photoForm.file);
      if (photoForm.note) {
        formData.append('note', photoForm.note);
      }
      await api.post(`/upload/tasks/${id}/images`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoForm({ file: null, note: '' });
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '上傳照片失敗。';
      setError(message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  useEffect(
    () => () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    },
    [audioPreviewUrl],
  );

  const clearAudioPreview = useCallback(() => {
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    setAudioPreviewUrl('');
  }, [audioPreviewUrl]);

  const handleAudioFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    clearAudioPreview();
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setAudioPreviewUrl(previewUrl);
    }
    setAudioForm((prev) => ({ ...prev, file }));
  };

  const handleAudioUpload = async (event) => {
    event.preventDefault();
    if (!audioForm.file) return;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      formData.append('file', audioForm.file);
      if (audioForm.note) {
        formData.append('note', audioForm.note);
      }
      if (audioForm.transcript) {
        formData.append('transcript', audioForm.transcript);
      }
      await api.post(`/upload/tasks/${id}/audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAudioForm({ file: null, note: '', transcript: '' });
      if (audioFileInputRef.current) {
        audioFileInputRef.current.value = '';
      }
      clearAudioPreview();
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '上傳語音失敗。';
      setError(message);
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleRecordedAudio = (blob) => {
    if (!blob) return;
    const type = blob.type || 'audio/webm';
    const extension =
      type.includes('mp3')
        ? 'mp3'
        : type.includes('ogg')
        ? 'ogg'
        : type.includes('wav')
        ? 'wav'
        : type.includes('m4a')
        ? 'm4a'
        : 'webm';
    const file = new File([blob], `recording-${Date.now()}.${extension}`, { type });
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = '';
    }
    clearAudioPreview();
    const previewUrl = URL.createObjectURL(blob);
    setAudioPreviewUrl(previewUrl);
    setAudioForm((prev) => ({ ...prev, file }));
  };

  const handleClearRecordedAudio = () => {
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = '';
    }
    clearAudioPreview();
    setAudioForm((prev) => ({ ...prev, file: null }));
  };

  const handleSignatureSubmit = async (dataUrl) => {
    if (!dataUrl) return;
    setUploadingSignature(true);
    try {
      await api.post(`/upload/tasks/${id}/signature`, {
        data_url: dataUrl,
        note: signatureNote || undefined,
      });
      setSignatureNote('');
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '上傳簽名失敗。';
      setError(message);
    } finally {
      setUploadingSignature(false);
    }
  };

  const handleStartTime = async () => {
    setTimeError('');
    setTimeMessage('');
    setTimeLoading(true);
    try {
      await api.post(`/tasks/${id}/time/start`);
      setTimeMessage('工時紀錄已開始。');
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '無法開始工時紀錄。';
      setTimeError(message);
    } finally {
      setTimeLoading(false);
    }
  };

  const handleStopTime = async () => {
    setTimeError('');
    setTimeMessage('');
    setTimeLoading(true);
    try {
      await api.post(`/tasks/${id}/time/stop`);
      setTimeMessage('工時紀錄已結束。');
      await loadTask();
    } catch (err) {
      const message = err.response?.data?.msg || '無法結束工時紀錄。';
      setTimeError(message);
    } finally {
      setTimeLoading(false);
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

      <nav className="tab-bar">
        {detailTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.key === activeTab ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'info' && (
        <>
          <section className="panel">
            <h2>任務資訊</h2>
            <p>狀態：{task.status}</p>
            <p>指派給：{task.assigned_to || '未指派'}</p>
            <p>建立人：{task.assigned_by || '系統'}</p>
            <p>內容：{task.description || '沒有描述'}</p>
            <p>地點：{task.location}</p>
            <p>預計完成時間：{formatDateTime(task.expected_time)}</p>
            <p>實際完成時間：{task.completed_at ? formatDateTime(task.completed_at) : '未完成'}</p>
            <p>總工時：{formatHours(task.total_work_hours)} 小時</p>
            {task.due_date && <p>截止日期：{formatDateTime(task.due_date)}</p>}
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
                        {option.username}（{labels[option.role] || option.role}）
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
                      <strong>{update.author || '系統'}</strong> - {formatDateTime(update.created_at)}
                    </p>
                    {update.status && <p>狀態：{update.status}</p>}
                    {update.note && <p>備註：{update.note}</p>}
                    {(update.start_time || update.end_time) && (
                      <p>
                        工時：
                        {update.start_time ? formatDateTime(update.start_time) : '未記錄'} →
                        {update.end_time ? formatDateTime(update.end_time) : '進行中'} （
                        {formatHours(update.work_hours)} 小時）
                      </p>
                    )}
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
        </>
      )}

      {activeTab === 'photos' && (
        <section className="panel">
          <h2>📷 照片紀錄</h2>
          {photoAttachments.length === 0 ? (
            <p>尚未上傳照片。</p>
          ) : (
            <div className="attachment-grid">
              {photoAttachments.map((attachment) => (
                <figure key={attachment.id}>
                  <img src={attachment.url} alt={attachment.original_name} />
                  <figcaption>
                    {attachment.original_name}
                    {attachment.note && <span>（{attachment.note}）</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <form className="stack" onSubmit={handlePhotoUpload}>
            <label>
              照片說明
              <input
                name="photo-note"
                value={photoForm.note}
                onChange={(event) =>
                  setPhotoForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="可填寫補充說明"
              />
            </label>
            <label>
              選擇照片
              <input type="file" accept="image/*" onChange={handlePhotoFileChange} />
            </label>
            <button type="submit" disabled={!photoForm.file || uploadingPhoto}>
              {uploadingPhoto ? '上傳中…' : '上傳照片'}
            </button>
          </form>
        </section>
      )}

      {activeTab === 'audio' && (
        <section className="panel">
          <h2>🎤 語音回報</h2>
          {audioAttachments.length === 0 ? (
            <p>尚未上傳語音檔。</p>
          ) : (
            <ul className="attachments">
              {audioAttachments.map((attachment) => (
                <li key={attachment.id}>
                  <audio controls src={attachment.url} />
                  <p>
                    {attachment.original_name}
                    {attachment.note && <span>（{attachment.note}）</span>}
                  </p>
                  {attachment.transcript && <p>逐字稿：{attachment.transcript}</p>}
                </li>
              ))}
            </ul>
          )}
          <form className="stack" onSubmit={handleAudioUpload}>
            <label>
              語音說明
              <input
                name="audio-note"
                value={audioForm.note}
                onChange={(event) =>
                  setAudioForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="可輸入語音內容概要"
              />
            </label>
            <label>
              語音逐字稿（選填）
              <textarea
                name="audio-transcript"
                value={audioForm.transcript}
                onChange={(event) =>
                  setAudioForm((prev) => ({ ...prev, transcript: event.target.value }))
                }
                placeholder="可預先輸入語音文字描述"
              />
            </label>
            <label>
              選擇語音檔
              <input
                ref={audioFileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleAudioFileChange}
              />
            </label>
            <AudioRecorder onRecordingComplete={handleRecordedAudio} disabled={uploadingAudio} />
            {audioForm.file && (
              <div className="attachment-preview">
                <p>
                  已準備檔案：
                  <strong>{audioForm.file.name}</strong>
                  <span>
                    （
                    {audioForm.file.size
                      ? `${(audioForm.file.size / 1024).toFixed(1)} KB`
                      : '大小未知'}
                    ）
                  </span>
                </p>
                {audioPreviewUrl && <audio controls src={audioPreviewUrl} />}
                <button
                  type="button"
                  onClick={handleClearRecordedAudio}
                  disabled={uploadingAudio}
                >
                  清除錄音
                </button>
              </div>
            )}
            <button type="submit" disabled={!audioForm.file || uploadingAudio}>
              {uploadingAudio ? '上傳中…' : '上傳語音'}
            </button>
          </form>
        </section>
      )}

      {activeTab === 'signature' && (
        <section className="panel">
          <h2>✍️ 電子簽名</h2>
          {signatureAttachment ? (
            <div className="signature-preview">
              <img src={signatureAttachment.url} alt="任務簽名" />
              <p>
                {signatureAttachment.note || '已上傳簽名'}
                {signatureAttachment.uploaded_at && (
                  <span>（{formatDateTime(signatureAttachment.uploaded_at)}）</span>
                )}
              </p>
            </div>
          ) : (
            <p>目前尚未上傳簽名。</p>
          )}
          <p className="hint-text">在下方畫布簽名並按送出即可更新簽名檔。</p>
          <label>
            簽名備註（選填）
            <input
              name="signature-note"
              value={signatureNote}
              onChange={(event) => setSignatureNote(event.target.value)}
              placeholder="可輸入簽名說明或負責人"
            />
          </label>
          <SignaturePad onSubmit={handleSignatureSubmit} disabled={uploadingSignature} />
          {uploadingSignature && <p className="hint-text">簽名上傳中…</p>}
        </section>
      )}

      {activeTab === 'time' && (
        <section className="panel">
          <h2>⏱ 工時紀錄</h2>
          {timeError && <p className="error-text">{timeError}</p>}
          {timeMessage && <p className="success-text">{timeMessage}</p>}
          <p>
            總工時：<strong>{formatHours(task.total_work_hours)} 小時</strong>
          </p>
          <div className="time-actions">
            <button type="button" onClick={handleStartTime} disabled={!!activeEntry || timeLoading}>
              {activeEntry ? '已開始' : '開始工作'}
            </button>
            <button type="button" onClick={handleStopTime} disabled={!activeEntry || timeLoading}>
              結束工作
            </button>
          </div>
          {activeEntry && (
            <p className="hint-text">
              工時進行中（開始於 {formatDateTime(activeEntry.start_time)}）
            </p>
          )}
          {timeEntries.length === 0 ? (
            <p>尚無工時紀錄。</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>使用者</th>
                  <th>開始時間</th>
                  <th>結束時間</th>
                  <th>工時（小時）</th>
                </tr>
              </thead>
              <tbody>
                {timeEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.author || `使用者 ${entry.user_id}`}</td>
                    <td>{entry.start_time ? formatDateTime(entry.start_time) : '—'}</td>
                    <td>{entry.end_time ? formatDateTime(entry.end_time) : '進行中'}</td>
                    <td>{formatHours(entry.work_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
};

export default TaskDetailPage;
