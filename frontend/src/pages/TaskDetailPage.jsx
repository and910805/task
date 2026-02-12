import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Select from 'react-select';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import AudioRecorder from '../components/task/AudioRecorder.jsx';
import SignaturePad from '../components/task/SignaturePad.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const statusOptions = [
  { value: 'Â∞öÊú™?•ÂñÆ', label: 'Â∞öÊú™?•ÂñÆ' },
  { value: 'Â∑≤Êé•??, label: 'Â∑≤Êé•?? },
  { value: '?≤Ë?‰∏?, label: '?≤Ë?‰∏? },
  { value: 'Â∑≤Â???, label: 'Â∑≤Â??? },
];

const statusTransitionMap = {
  'Â∞öÊú™?•ÂñÆ': ['Â∑≤Êé•??, '?≤Ë?‰∏?],
  'Â∑≤Êé•??: ['?≤Ë?‰∏?],
  '?≤Ë?‰∏?: ['Â∑≤Â???],
  'Â∑≤Â???: [],
};

const statusBadgeClass = {
  Â∞öÊú™?•ÂñÆ: 'status-badge status-pending',
  Â∑≤Êé•?? 'status-badge status-in-progress',
  ?≤Ë?‰∏? 'status-badge status-in-progress',
  Â∑≤Â??? 'status-badge status-completed',
};
const defaultNoteTemplates = [
  'Â∑≤Âà∞?¥Ô??ãÂ?‰ΩúÊ•≠??,
  'Â∑≤Â??êÊ™¢‰øÆ„Ä?,
  'Á≠âÂ??êÊ?/?∂‰ª∂‰∏≠„Ä?,
  'Â∑≤Â??ê‰∏¶Ê∏ÖÊ??∂Â∞æ??,
];
const detailTabs = [
  { key: 'info', label: '?πÔ? ‰ªªÂ?Ë≥áË?' },
  { key: 'photos', label: '?ì∑ ?ßÁ?' },
  { key: 'audio', label: '?é§ Ë™ûÈü≥' },
  { key: 'signature', label: '?çÔ? Á∞ΩÂ?' },
  { key: 'time', label: '??Â∑•Ê?' },
];

const toInputDatetimeValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offsetInMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetInMs);
  return local.toISOString().slice(0, 16);
};

const formatDateTime = (value) => {
  if (!value) return '?™Ë®≠ÂÆ?;
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    return value;
  }
};

const formatHours = (hours) => Number(hours ?? 0).toFixed(2);

const parseAssigneeChangeNote = (note) => {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (err) {
    return null;
  }
  return null;
};

const formatAssigneeChangeSummary = (note) => {
  const payload = parseAssigneeChangeNote(note);
  if (!payload) return '?áÊ¥æÂ∞çË±°Â∑≤Êõ¥?∞„Ä?;

  const fromNames = payload.from_names || [];
  const toNames = payload.to_names || [];
  const fromIds = payload.from_ids || [];
  const toIds = payload.to_ids || [];

  const fromLabel =
    fromNames.length > 0 ? fromNames.join('??) : fromIds.length > 0 ? fromIds.join('??) : '?™Ê?Ê¥?;
  const toLabel =
    toNames.length > 0 ? toNames.join('??) : toIds.length > 0 ? toIds.join('??) : '?™Ê?Ê¥?;

  return `?áÊ¥æÂ∞çË±°??${fromLabel} ËÆäÊõ¥??${toLabel}`;
};

const TaskDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { labels } = useRoleLabels();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const [assignmentSuccess, setAssignmentSuccess] = useState('');
  const [updateForm, setUpdateForm] = useState({ status: '', note: '' });
  const [loading, setLoading] = useState(true);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    assignee_ids: [],
    due_date: '',
    location_url: '',
  });
  const [activeTab, setActiveTab] = useState('info');
  const [photoForm, setPhotoForm] = useState({ file: null, note: '' });
  const [audioForm, setAudioForm] = useState({ file: null, note: '', transcript: '' });
  const [signatureNote, setSignatureNote] = useState('');
  const [timeMessage, setTimeMessage] = useState('');
  const [timeError, setTimeError] = useState('');
  const [timeLoading, setTimeLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [acceptingTask, setAcceptingTask] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState('');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [photoPreviewMeta, setPhotoPreviewMeta] = useState(null);
  const photoFileInputRef = useRef(null);
  const audioFileInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const [noteTemplates, setNoteTemplates] = useState(defaultNoteTemplates);

  const isManager = useMemo(() => managerRoles.has(user?.role), [user?.role]);
  const isWorker = useMemo(() => user?.role === 'worker', [user?.role]);
  const hasNotificationPreference = user?.notification_type && user?.notification_type !== 'none';
  const [showOverdue, setShowOverdue] = useState(Boolean(hasNotificationPreference));

  const getErrorMessage = (err, fallback) =>
    err?.networkMessage || err?.response?.data?.msg || fallback;

  const loadNoteTemplates = useCallback(async () => {
    try {
      const { data } = await api.get('settings/task-update-templates');
      if (Array.isArray(data?.templates)) {
        setNoteTemplates(data.templates);
        return;
      }
    } catch (err) {
      console.error('?°Ê??ñÂ??ôË®ªÊ®°Êùø', err);
    }
    setNoteTemplates(defaultNoteTemplates);
  }, []);

  const loadTask = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`tasks/${id}`);
      setTask(data);
    } catch (err) {
      const message = getErrorMessage(err, '?æ‰??∞Ë©≤‰ªªÂ???);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadAssignableUsers = async () => {
    if (!isManager) return;
    try {
      const { data } = await api.get('auth/assignable-users');
      setAssignableUsers(data);
    } catch (err) {
      console.error('?°Ê??ñÂ??ØÊ?Ê¥æ‰Ωø?®ËÄÖÂ?Ë°?, err);
    }
  };

  useEffect(() => {
    loadTask();
  }, [id]);

  useEffect(() => {
    loadNoteTemplates();
  }, [loadNoteTemplates]);

  useEffect(() => {
    if (isManager) {
      loadAssignableUsers();
    }
  }, [isManager]);

  useEffect(() => {
    setShowOverdue(Boolean(hasNotificationPreference));
  }, [hasNotificationPreference]);

  const assigneeOptions = useMemo(
    () =>
      assignableUsers.map((option) => ({
        value: option.id,
        label: `${option.username}Ôº?{labels[option.role] || option.role}Ôºâ`,
      })),
    [assignableUsers, labels],
  );

  useEffect(() => {
    if (!task) return;
    setAssignmentForm({
      assignee_ids: task.assignee_ids ? [...task.assignee_ids] : [],
      due_date: task.due_date ? toInputDatetimeValue(task.due_date) : '',
      location_url: task.location_url || '',
    });
  }, [task]);

  const availableStatusOptions = useMemo(() => {
    if (!task?.status) return statusOptions;
    const allowed = statusTransitionMap[task.status];
    if (!allowed) return [];
    return statusOptions.filter((option) => allowed.includes(option.value));
  }, [task?.status]);

  useEffect(() => {
    if (!updateForm.status) return;
    const allowedValues = new Set(availableStatusOptions.map((option) => option.value));
    if (!allowedValues.has(updateForm.status)) {
      setUpdateForm((prev) => ({ ...prev, status: '' }));
    }
  }, [availableStatusOptions, updateForm.status]);

  const buildAttachmentUrl = useCallback((url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    try {
      return new URL(url, window.location.origin).toString();
    } catch (error) {
      return url;
    }
  }, []);

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
  const latestPhotoAttachment = useMemo(() => {
    if (photoAttachments.length === 0) return null;
    return [...photoAttachments].sort((a, b) => {
      const aTime = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
      const bTime = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.id || 0) - (a.id || 0);
    })[0];
  }, [photoAttachments]);
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
  const canAcceptTask = useMemo(
    () => isWorker && task?.status === 'Â∞öÊú™?•ÂñÆ' && !task?.assigned_to_id,
    [isWorker, task],
  );
  const isOverdue = useMemo(() => {
    if (!task?.due_date) return false;
    if (task.status === 'Â∑≤Â???) return false;
    if (task.is_overdue !== undefined) return Boolean(task.is_overdue);
    return new Date(task.due_date).getTime() < Date.now();
  }, [task]);
  const showOverdueIndicator = showOverdue && isOverdue;

  const handleUpdateChange = (event) => {
    const { name, value } = event.target;
    setUpdateForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleNoteTemplateClick = (template) => {
    setUpdateForm((prev) => ({ ...prev, note: template }));
    if (noteInputRef.current) {
      noteInputRef.current.focus();
    }
  };

  const handleAssignmentChange = (event) => {
    const { name, value } = event.target;
    setAssignmentForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAssigneeSelect = (selected) => {
    setAssignmentForm((prev) => ({
      ...prev,
      assignee_ids: (selected || []).map((option) => option.value),
    }));
  };

  const handleStatusSubmit = async (event) => {
    event.preventDefault();

    // ???∞Â?ÔºöÂ∑•‰∫∫Â?Â∑•Â?ÁΩÆÊ™¢??
    const nextStatus = (updateForm.status || '').trim();
    const note = (updateForm.note || '').trim();

    if (isWorker && nextStatus === 'Â∑≤Â???) {
      const missingItems = [];

      if (!note) {
        missingItems.push('Â°´ÂØ´Ë™™Ê?ÔºàÂ?Ë®ªÔ?');
      }
      if (photoAttachments.length === 0) {
        missingItems.push('?≥Â? 1 ÂºµÁÖß??);
      }

      if (missingItems.length > 0) {
        setError(`ÂÆåÊ?‰ªªÂ??çË???{missingItems.join('??)}?Ç`);
        if (missingItems.includes('?≥Â? 1 ÂºµÁÖß??)) {
          setActiveTab('photos');
        }
        return;
      }
    }

    if (!updateForm.status && !updateForm.note) return;

    try {
      const payload = {
        status: updateForm.status || undefined,
        note: updateForm.note || undefined,
      };
      await api.post(`tasks/${id}/updates`, payload);
      setUpdateForm({ status: '', note: '' });
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '?¥Êñ∞?Ä?ãÂ§±?ó„Ä?);
      setError(message);
    }
  };


  const handleAssignmentSubmit = async (event) => {
    event.preventDefault();
    setAssignmentError('');
    setAssignmentSuccess('');
    try {
      const payload = {
        assignee_ids: assignmentForm.assignee_ids.map(Number),
        due_date: assignmentForm.due_date || null,
        location_url: assignmentForm.location_url.trim() || null,
      };
      await api.put(`tasks/${id}`, payload);
      setAssignmentSuccess('‰ªªÂ??áÊ¥æË≥áË?Â∑≤Êõ¥?∞„Ä?);
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '?¥Êñ∞‰ªªÂ??áÊ¥æÂ§±Ê???);
      setAssignmentError(message);
    }
  };

  const clearPhotoPreview = useCallback(() => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoPreviewUrl('');
    setPhotoPreviewMeta(null);
  }, [photoPreviewUrl]);

  const loadImageFromFile = (file) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      };
      img.src = url;
    });

  const compressImage = useCallback(async (file) => {
    const maxDimension = 1600;
    const quality = 0.82;
    const image = await loadImageFromFile(file);
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const targetWidth = Math.round(image.width * scale);
    const targetHeight = Math.round(image.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('?°Ê?Âª∫Á??´Â??≤Ë?Â£ìÁ∏Æ');
    }
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Â£ìÁ∏ÆÂ§±Ê?'));
          }
        },
        outputType,
        quality,
      );
    });
    return new File([blob], file.name, { type: outputType });
  }, []);

  const handlePhotoFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    clearPhotoPreview();
    if (!file) {
      setPhotoForm((prev) => ({ ...prev, file: null }));
      return;
    }
    setPhotoProcessing(true);
    try {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed);
      setPhotoPreviewUrl(previewUrl);
      setPhotoPreviewMeta({
        name: compressed.name,
        size: compressed.size,
        type: compressed.type,
        originalSize: file.size,
      });
      setPhotoForm((prev) => ({ ...prev, file: compressed }));
    } catch (err) {
      setError('?ßÁ?Â£ìÁ∏ÆÂ§±Ê?ÔºåË??çÊñ∞?∏Ê?Ê™îÊ???);
      setPhotoForm((prev) => ({ ...prev, file: null }));
      if (photoFileInputRef.current) {
        photoFileInputRef.current.value = '';
      }
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handlePhotoUpload = async (event) => {
    event.preventDefault();
    if (!photoForm.file || photoProcessing) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', photoForm.file);
      if (photoForm.note) {
        formData.append('note', photoForm.note);
      }
      await api.post(`upload/tasks/${id}/images`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoForm({ file: null, note: '' });
      clearPhotoPreview();
      if (photoFileInputRef.current) {
        photoFileInputRef.current.value = '';
      }
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '‰∏äÂÇ≥?ßÁ?Â§±Ê???);
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

  useEffect(
    () => () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    },
    [photoPreviewUrl],
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
      await api.post(`upload/tasks/${id}/audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAudioForm({ file: null, note: '', transcript: '' });
      if (audioFileInputRef.current) {
        audioFileInputRef.current.value = '';
      }
      clearAudioPreview();
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '‰∏äÂÇ≥Ë™ûÈü≥Â§±Ê???);
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
      await api.post(`upload/tasks/${id}/signature`, {
        data_url: dataUrl,
        note: signatureNote || undefined,
      });
      setSignatureNote('');
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '‰∏äÂÇ≥Á∞ΩÂ?Â§±Ê???);
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
      await api.post(`tasks/${id}/time/start`);
      setTimeMessage('Â∑•Ê?Á¥Ä?ÑÂ∑≤?ãÂ???);
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '?°Ê??ãÂ?Â∑•Ê?Á¥Ä?Ñ„Ä?);
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
      await api.post(`tasks/${id}/time/stop`);
      setTimeMessage('Â∑•Ê?Á¥Ä?ÑÂ∑≤ÁµêÊ???);
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '?°Ê?ÁµêÊ?Â∑•Ê?Á¥Ä?Ñ„Ä?);
      setTimeError(message);
    } finally {
      setTimeLoading(false);
    }
  };

  const handleAcceptTask = async () => {
    setError('');
    setAcceptingTask(true);
    try {
      await api.post(`tasks/${id}/accept`);
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '?•ÂñÆÂ§±Ê???);
      setError(message);
    } finally {
      setAcceptingTask(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <p>ËºâÂÖ•‰∏?..</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="page">
        <p>{error || '?°Ê?È°ØÁ§∫‰ªªÂ???}</p>
        <button type="button" className="secondary-button" onClick={loadTask}>
          ?çË©¶
        </button>
        <button type="button" onClick={() => navigate(-1)}>
          ËøîÂ?
        </button>
      </div>
    );
  }

  return (
    <div className="page task-detail-page mobile-tabs">
      <AppHeader title={task.title} subtitle={`‰ªªÂ?Á∑®Ë?Ôº?{task.id}`}>
        <Link to="/" className="link-button">
          ??ËøîÂ?‰ªªÂ??óË°®
        </Link>
      </AppHeader>
      {error && (
        <div className="error-text" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={loadTask}>
            ?çË©¶
          </button>
        </div>
      )}

      <nav className="tab-bar tab-bar--top">
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
          <section className={`panel${showOverdueIndicator ? ' task-overdue' : ''}`}>
            <h2>‰ªªÂ?Ë≥áË?</h2>
            <p>
              ?Ä?ãÔ?
              <span className={statusBadgeClass[task.status] || 'status-badge'}>
                ??{task.status}
              </span>
              {showOverdueIndicator && (
                <span className="status-badge status-overdue">?†Ô? ?æÊ?</span>
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={showOverdue}
                onChange={(event) => setShowOverdue(event.target.checked)}
              />
              È°ØÁ§∫?æÊ??êÈ?
            </label>
            <div className="info-quick-actions">
              <div className="info-quick-actions__buttons">
                {canAcceptTask && (
                  <button type="button" onClick={handleAcceptTask} disabled={acceptingTask}>
                    {acceptingTask ? '?•ÂñÆ‰∏≠‚Ä? : '?•ÂñÆ'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStartTime}
                  disabled={!!activeEntry || timeLoading}
                >
                  {activeEntry ? 'Â∑≤È?Âß? : '?ãÂ?Â∑•Ê?'}
                </button>
                <button type="button" onClick={handleStopTime} disabled={!activeEntry || timeLoading}>
                  ÁµêÊ?Â∑•Ê?
                </button>
              </div>
              {timeError && <p className="error-text">{timeError}</p>}
              {timeMessage && <p className="success-text">{timeMessage}</p>}
              {activeEntry && (
                <p className="hint-text">
                  Â∑•Ê??≤Ë?‰∏≠Ô??ãÂ???{formatDateTime(activeEntry.start_time)}Ôº?
                </p>
              )}
            </div>
            <div>
              <strong>?áÊ¥æÂ∞çË±°Ôº?/strong>
              {task.assignees && task.assignees.length > 0 ? (
                <div className="chip-list">
                  {task.assignees.map((assignee) => (
                    <span key={assignee.id} className="chip">
                      {assignee.username}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="hint-text">?™Ê?Ê¥?/span>
              )}
            </div>
            <p>Âª∫Á?‰∫∫Ô?{task.assigned_by || 'Á≥ªÁµ±'}</p>
            <p>?ßÂÆπÔºö{task.description || 'Ê≤íÊ??èËø∞'}</p>
            <p>?∞È?Ôºö{task.location}</p>
            {task.location_url && (
              <p>
                ?∞Â????Ôº?
                <a href={task.location_url} target="_blank" rel="noreferrer">
                  {task.location_url}
                </a>
              </p>
            )}
            <p>?êË?ÂÆåÊ??ÇÈ?Ôºö{formatDateTime(task.expected_time)}</p>
            <p>ÂØ¶È?ÂÆåÊ??ÇÈ?Ôºö{task.completed_at ? formatDateTime(task.completed_at) : '?™Â???}</p>
            <p>Á∏ΩÂ∑•?ÇÔ?{formatHours(task.total_work_hours)} Â∞èÊ?</p>
            {task.due_date && (
              <p>
                ?™Ê≠¢?•Ê?Ôºö{formatDateTime(task.due_date)}
                {showOverdueIndicator && <span className="hint-text">ÔºàÂ∑≤?æÊ?Ôº?/span>}
              </p>
            )}
          </section>

          {isManager && (
            <section className="panel">
              <h2>?áÊ¥æË®≠Â?</h2>
              {assignmentError && <p className="error-text">{assignmentError}</p>}
              {assignmentSuccess && <p className="success-text">{assignmentSuccess}</p>}
              <form className="stack" onSubmit={handleAssignmentSubmit}>
                <label>
                  ?áÊ¥æÁµ?
                  <Select
                    isMulti
                    classNamePrefix="assignee-select"
                    placeholder="?∏Ê?Ë≤†Ë≤¨‰∫?
                    options={assigneeOptions}
                    value={assigneeOptions.filter((option) =>
                      assignmentForm.assignee_ids.includes(option.value),
                    )}
                    onChange={handleAssigneeSelect}
                    isClearable
                    closeMenuOnSelect={false}
                  />
                </label>
                <label>
                  ?™Ê≠¢?ÇÈ?
                  <input
                    type="datetime-local"
                    name="due_date"
                    value={assignmentForm.due_date}
                    onChange={handleAssignmentChange}
                  />
                </label>
                <label>
                  ?∞Â????
                  <input
                    type="url"
                    name="location_url"
                    value={assignmentForm.location_url}
                    onChange={handleAssignmentChange}
                    placeholder="?ØË≤º‰∏?Google ?∞Â????"
                  />
                </label>
                <button type="submit">?≤Â??áÊ¥æ</button>
              </form>
            </section>
          )}

          <section className="panel">
            <h2>?Ä?ãÊõ¥?∞Ë??ûÂ†±</h2>
            {task.updates.length === 0 ? (
              <p>Â∞öÁÑ°?ûÂ†±??/p>
            ) : (
              <ul className="updates">
                {task.updates.map((update) => {
                  const isAssigneeChange = update.status === '?áÊ¥æËÆäÊõ¥';
                  const assigneeSummary = isAssigneeChange
                    ? formatAssigneeChangeSummary(update.note)
                    : null;

                  return (
                    <li key={update.id}>
                      <p>
                        <strong>{update.author || 'Á≥ªÁµ±'}</strong> -{' '}
                        {formatDateTime(update.created_at)}
                      </p>
                      {update.status && <p>?Ä?ãÔ?{update.status}</p>}
                      {isAssigneeChange && <p>{assigneeSummary}</p>}
                      {update.note && !isAssigneeChange && <p>?ôË®ªÔºö{update.note}</p>}
                      {(update.start_time || update.end_time) && (
                        <p>
                          Â∑•Ê?Ôº?
                          {update.start_time ? formatDateTime(update.start_time) : '?™Ë???} ??
                          {update.end_time ? formatDateTime(update.end_time) : '?≤Ë?‰∏?} Ôº?
                          {formatHours(update.work_hours)} Â∞èÊ?Ôº?
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="stack" onSubmit={handleStatusSubmit}>
              <label>
                ?Ä??
                <select name="status" value={updateForm.status} onChange={handleUpdateChange}>
                  <option value="">?∏Ê??Ä??/option>
                  {availableStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ?ôË®ª
                <textarea
                  ref={noteInputRef}
                  name="note"
                  value={updateForm.note}
                  onChange={handleUpdateChange}
                  placeholder="Â°´ÂØ´?ûÂ†±?ßÂÆπ"
                />
              </label>
              {noteTemplates.length > 0 && (
                <div className="note-template-picker">
                  <p className="hint-text">Â∏∏Áî®?ôË®ªÂø´ÈÄüÈÅ∏??/p>
                  <div className="chip-list">
                    {noteTemplates.map((template, index) => (
                      <button
                        key={`${template}-${index}`}
                        type="button"
                        className="chip chip-button"
                        onClick={() => handleNoteTemplateClick(template)}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="submit">?ÅÂá∫?ûÂ†±</button>
            </form>
          </section>
        </>
      )}

      {activeTab === 'photos' && (
        <section className="panel">
          <h2>?ì∑ ?ßÁ?Á¥Ä??/h2>
          {latestPhotoAttachment && (
            <div className="attachment-preview">
              <p>?Ä?∞ÁÖß??/p>
              <figure>
                <img
                  src={latestPhotoAttachment.url}
                  alt={latestPhotoAttachment.original_name}
                />
                <figcaption>
                  {latestPhotoAttachment.original_name}
                  {latestPhotoAttachment.note && <span>Ôºà{latestPhotoAttachment.note}Ôº?/span>}
                </figcaption>
              </figure>
            </div>
          )}
          {photoAttachments.length === 0 ? (
            <p>Â∞öÊú™‰∏äÂÇ≥?ßÁ???/p>
          ) : (
            <div className="attachment-grid">
              {photoAttachments.map((attachment) => (
                <figure key={attachment.id}>
                  <img src={attachment.url} alt={attachment.original_name} />
                  <figcaption>
                    {attachment.original_name}
                    {attachment.note && <span>Ôºà{attachment.note}Ôº?/span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <form className="stack" onSubmit={handlePhotoUpload}>
            <label>
              ?ßÁ?Ë™™Ê?
              <input
                name="photo-note"
                value={photoForm.note}
                onChange={(event) =>
                  setPhotoForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="?ØÂ°´ÂØ´Ë??ÖË™™??
              />
            </label>
            <label>
              ?∏Ê??ßÁ?
              <input
                ref={photoFileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoFileChange}
              />
            </label>
            {photoProcessing && <p className="hint-text">?ßÁ??ïÁ?‰∏≠‚Ä?/p>}
            {photoPreviewUrl && photoPreviewMeta && (
              <div className="attachment-preview">
                <p>
                  Â£ìÁ∏ÆÂæåÈ?Ë¶ΩÔ?<strong>{photoPreviewMeta.name}</strong>{' '}
                  <span>
                    Ôº?
                    {photoPreviewMeta.size
                      ? `${(photoPreviewMeta.size / 1024).toFixed(1)} KB`
                      : 'Â§ßÂ??™Áü•'}
                    ÔºåÂ?ÂßãÊ?
                    {photoPreviewMeta.originalSize
                      ? `${(photoPreviewMeta.originalSize / 1024).toFixed(1)} KB`
                      : '?™Áü•'}
                    Ôº?
                  </span>
                </p>
                <img src={photoPreviewUrl} alt="‰∏äÂÇ≥?ßÁ??êË¶Ω" />
              </div>
            )}
            <button type="submit" disabled={!photoForm.file || uploadingPhoto || photoProcessing}>
              {uploadingPhoto ? '‰∏äÂÇ≥‰∏≠‚Ä? : '‰∏äÂÇ≥?ßÁ?'}
            </button>
          </form>
        </section>
      )}

      {activeTab === 'audio' && (
        <section className="panel">
          <h2>?é§ Ë™ûÈü≥?ûÂ†±</h2>
          {audioAttachments.length === 0 ? (
            <p>Â∞öÊú™‰∏äÂÇ≥Ë™ûÈü≥Ê™î„Ä?/p>
          ) : (
            <ul className="attachments">
              {audioAttachments.map((attachment) => (
                <li key={attachment.id}>
                  <audio controls src={attachment.url} />
                  <p>
                    {attachment.original_name}
                    {attachment.note && <span>Ôºà{attachment.note}Ôº?/span>}
                  </p>
                  {attachment.transcript && <p>?êÂ?Á®øÔ?{attachment.transcript}</p>}
                </li>
              ))}
            </ul>
          )}
          <form className="stack" onSubmit={handleAudioUpload}>
            <label>
              Ë™ûÈü≥Ë™™Ê?
              <input
                name="audio-note"
                value={audioForm.note}
                onChange={(event) =>
                  setAudioForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="?ØËº∏?•Ë??≥ÂÖßÂÆπÊ?Ë¶?
              />
            </label>
            <label>
              Ë™ûÈü≥?êÂ?Á®øÔ??∏Â°´Ôº?
              <textarea
                name="audio-transcript"
                value={audioForm.transcript}
                onChange={(event) =>
                  setAudioForm((prev) => ({ ...prev, transcript: event.target.value }))
                }
                placeholder="?ØÈ??àËº∏?•Ë??≥Ê?Â≠óÊ?Ëø?
              />
            </label>
            <label>
              ?∏Ê?Ë™ûÈü≥Ê™?
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
                  Â∑≤Ê??ôÊ?Ê°àÔ?
                  <strong>{audioForm.file.name}</strong>
                  <span>
                    Ôº?
                    {audioForm.file.size
                      ? `${(audioForm.file.size / 1024).toFixed(1)} KB`
                      : 'Â§ßÂ??™Áü•'}
                    Ôº?
                  </span>
                </p>
                {audioPreviewUrl && <audio controls src={audioPreviewUrl} />}
                <button
                  type="button"
                  onClick={handleClearRecordedAudio}
                  disabled={uploadingAudio}
                >
                  Ê∏ÖÈô§?ÑÈü≥
                </button>
              </div>
            )}
            <button type="submit" disabled={!audioForm.file || uploadingAudio}>
              {uploadingAudio ? '‰∏äÂÇ≥‰∏≠‚Ä? : '‰∏äÂÇ≥Ë™ûÈü≥'}
            </button>
          </form>
        </section>
      )}

      {activeTab === 'signature' && (
        <section className="panel">
          <h2>?çÔ? ?ªÂ?Á∞ΩÂ?</h2>
          {signatureAttachment ? (
            <div className="signature-preview">
              <img src={signatureAttachment.url} alt="‰ªªÂ?Á∞ΩÂ?" />
              <p>
                {signatureAttachment.note || 'Â∑≤‰??≥Á∞Ω??}
                {signatureAttachment.uploaded_at && (
                  <span>Ôºà{formatDateTime(signatureAttachment.uploaded_at)}Ôº?/span>
                )}
              </p>
            </div>
          ) : (
            <p>?ÆÂ?Â∞öÊú™‰∏äÂÇ≥Á∞ΩÂ???/p>
          )}
          <p className="hint-text">?®‰??πÁï´Â∏ÉÁ∞Ω?ç‰∏¶?âÈÄÅÂá∫?≥ÂèØ?¥Êñ∞Á∞ΩÂ?Ê™î„Ä?/p>
          <label>
            Á∞ΩÂ??ôË®ªÔºàÈÅ∏Â°´Ô?
            <input
              name="signature-note"
              value={signatureNote}
              onChange={(event) => setSignatureNote(event.target.value)}
              placeholder="?ØËº∏?•Á∞Ω?çË™™?éÊ?Ë≤†Ë≤¨‰∫?
            />
          </label>
          <SignaturePad onSubmit={handleSignatureSubmit} disabled={uploadingSignature} />
          {uploadingSignature && <p className="hint-text">Á∞ΩÂ?‰∏äÂÇ≥‰∏≠‚Ä?/p>}
        </section>
      )}

      {activeTab === 'time' && (
        <section className="panel">
          <h2>??Â∑•Ê?Á¥Ä??/h2>
          {timeError && <p className="error-text">{timeError}</p>}
          {timeMessage && <p className="success-text">{timeMessage}</p>}
          <p>
            Á∏ΩÂ∑•?ÇÔ?<strong>{formatHours(task.total_work_hours)} Â∞èÊ?</strong>
          </p>
          <div className="time-actions">
            <button type="button" onClick={handleStartTime} disabled={!!activeEntry || timeLoading}>
              {activeEntry ? 'Â∑≤È?Âß? : '?ãÂ?Â∑•‰?'}
            </button>
            <button type="button" onClick={handleStopTime} disabled={!activeEntry || timeLoading}>
              ÁµêÊ?Â∑•‰?
            </button>
          </div>
          {activeEntry && (
            <p className="hint-text">
              Â∑•Ê??≤Ë?‰∏≠Ô??ãÂ???{formatDateTime(activeEntry.start_time)}Ôº?
            </p>
          )}
          {timeEntries.length === 0 ? (
            <p>Â∞öÁÑ°Â∑•Ê?Á¥Ä?Ñ„Ä?/p>
          ) : (
            <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>‰ΩøÁî®??/th>
                  <th>?ãÂ??ÇÈ?</th>
                  <th>ÁµêÊ??ÇÈ?</th>
                  <th>Â∑•Ê?ÔºàÂ??ÇÔ?</th>
                </tr>
              </thead>
              <tbody>
                {timeEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.author || `‰ΩøÁî®??${entry.user_id}`}</td>
                    <td>{entry.start_time ? formatDateTime(entry.start_time) : '??}</td>
                    <td>{entry.end_time ? formatDateTime(entry.end_time) : '?≤Ë?‰∏?}</td>
                    <td>{formatHours(entry.work_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      )}

      <nav className="tab-bar tab-bar--bottom">
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
    </div>
  );
};

export default TaskDetailPage;
