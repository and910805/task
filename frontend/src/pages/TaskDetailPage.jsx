import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Select from 'react-select';

import api from '../api/client.js';
import AppHeader from '../components/AppHeader.jsx';
import AudioRecorder from '../components/task/AudioRecorder.jsx';
import SignaturePad from '../components/task/SignaturePad.jsx';
import TaskMaterialsPanel from '../components/task/TaskMaterialsPanel.jsx';
import { managerRoles } from '../constants/roles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRoleLabels } from '../context/RoleLabelContext.jsx';

const statusOptions = [
  { value: '尚未接單', label: '尚未接單' },
  { value: '已接單', label: '已接單' },
  { value: '進行中', label: '進行中' },
  { value: '已完成', label: '已完成' },
];

const statusTransitionMap = {
  '尚未接單': ['已接單', '進行中'],
  '已接單': ['進行中'],
  '進行中': ['已完成'],
  '已完成': [],
};

const statusBadgeClass = {
  尚未接單: 'status-badge status-pending',
  已接單: 'status-badge status-in-progress',
  進行中: 'status-badge status-in-progress',
  已完成: 'status-badge status-completed',
};
const defaultNoteTemplates = [
  '已到場，開始作業。',
  '已完成檢修。',
  '等待材料/零件中。',
  '已完成並清潔收尾。',
];
const detailTabs = [
  { key: 'info', label: 'ℹ️ 任務資訊' },
  { key: 'photos', label: '📷 照片' },
  { key: 'audio', label: '🎤 語音' },
  { key: 'signature', label: '✍️ 簽名' },
  { key: 'materials', label: '🧰 耗材' },
  { key: 'time', label: '⏱ 工時' },
];

const toInputDatetimeValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offsetInMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetInMs);
  return local.toISOString().slice(0, 16);
};

const toApiDatetimeValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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
  if (!payload) return '指派對象已更新。';

  const fromNames = payload.from_names || [];
  const toNames = payload.to_names || [];
  const fromIds = payload.from_ids || [];
  const toIds = payload.to_ids || [];

  const fromLabel =
    fromNames.length > 0 ? fromNames.join('、') : fromIds.length > 0 ? fromIds.join('、') : '未指派';
  const toLabel =
    toNames.length > 0 ? toNames.join('、') : toIds.length > 0 ? toIds.join('、') : '未指派';

  return `指派對象由 ${fromLabel} 變更為 ${toLabel}`;
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
  const [bulkTimeForm, setBulkTimeForm] = useState({
    user_ids: [],
    start_time: '',
    end_time: '',
    work_hours: '',
    note: '',
  });
  const [bulkTimeLoading, setBulkTimeLoading] = useState(false);
  const [editingTimeEntryId, setEditingTimeEntryId] = useState(null);
  const [editingTimeForm, setEditingTimeForm] = useState({
    user_id: '',
    start_time: '',
    end_time: '',
    work_hours: '',
    note: '',
  });
  const [editingTimeLoading, setEditingTimeLoading] = useState(false);
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
      console.error('無法取得備註模板', err);
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
      const message = getErrorMessage(err, '找不到該任務。');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadAssignableUsers = async () => {
    if (!isManager && !isWorker) return;
    try {
      const { data } = await api.get('auth/assignable-users');
      setAssignableUsers(data);
    } catch (err) {
      console.error('無法取得可指派使用者列表', err);
    }
  };

  useEffect(() => {
    loadTask();
  }, [id]);

  useEffect(() => {
    loadNoteTemplates();
  }, [loadNoteTemplates]);

  useEffect(() => {
    if (isManager || isWorker) {
      loadAssignableUsers();
    }
  }, [isManager, isWorker]);

  useEffect(() => {
    setShowOverdue(Boolean(hasNotificationPreference));
  }, [hasNotificationPreference]);

  const assigneeOptions = useMemo(
    () =>
      assignableUsers.map((option) => ({
        value: option.id,
        label: `${option.username}（${labels[option.role] || option.role}）`,
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
  const taskAssigneeIds = useMemo(
    () => {
      const ids = Array.isArray(task?.assignee_ids) ? task.assignee_ids.map(Number) : [];
      if (task?.assigned_to_id) {
        ids.push(Number(task.assigned_to_id));
      }
      return Array.from(new Set(ids));
    },
    [task?.assignee_ids, task?.assigned_to_id],
  );
  const isTaskAssignee = useMemo(
    () => (user?.id ? taskAssigneeIds.includes(Number(user.id)) : false),
    [taskAssigneeIds, user?.id],
  );
  const canAssistAssignment = useMemo(
    () => isWorker && isTaskAssignee,
    [isWorker, isTaskAssignee],
  );
  const canManageAssignmentPanel = isManager || canAssistAssignment;
  const canManageMultiTime = isManager || canAssistAssignment;
  const timeTargetOptions = useMemo(
    () => assigneeOptions.filter((option) => taskAssigneeIds.includes(Number(option.value))),
    [assigneeOptions, taskAssigneeIds],
  );
  const activeEntry = useMemo(
    () => timeEntries.find((entry) => entry.user_id === user?.id && !entry.end_time) || null,
    [timeEntries, user?.id],
  );
  const canAcceptTask = useMemo(
    () => isWorker && task?.status === '尚未接單' && !task?.assigned_to_id,
    [isWorker, task],
  );
  const isOverdue = useMemo(() => {
    if (!task?.due_date) return false;
    if (task.status === '已完成') return false;
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

    // ✅ 新增：工人完工前置檢查
    const nextStatus = (updateForm.status || '').trim();
    const note = (updateForm.note || '').trim();

    if (isWorker && nextStatus === '已完成') {
      const missingItems = [];

      if (!note) {
        missingItems.push('填寫說明（備註）');
      }
      if (photoAttachments.length === 0) {
        missingItems.push('至少 1 張照片');
      }

      if (missingItems.length > 0) {
        setError(`完成任務前請先${missingItems.join('、')}。`);
        if (missingItems.includes('至少 1 張照片')) {
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
      const message = getErrorMessage(err, '更新狀態失敗。');
      setError(message);
    }
  };

  const handleAssignmentSubmit = async (event) => {
    event.preventDefault();
    setAssignmentError('');
    setAssignmentSuccess('');
    try {
      if (canAssistAssignment && !isManager) {
        await api.post(`tasks/${id}/assignees/add`, {
          assignee_ids: assignmentForm.assignee_ids.map(Number),
        });
        setAssignmentSuccess('已將人員加入任務。');
      } else {
        const payload = {
          assignee_ids: assignmentForm.assignee_ids.map(Number),
          due_date: assignmentForm.due_date || null,
          location_url: assignmentForm.location_url.trim() || null,
        };
        await api.put(`tasks/${id}`, payload);
        setAssignmentSuccess('派工設定已更新。');
      }
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '更新派工設定失敗。');
      setAssignmentError(message);
    }
  };

  const handleBulkTimeChange = (event) => {
    const { name, value } = event.target;
    setBulkTimeForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleBulkTimeUsersChange = (selected) => {
    setBulkTimeForm((prev) => ({
      ...prev,
      user_ids: (selected || []).map((option) => Number(option.value)),
    }));
  };

  const handleBulkTimeSubmit = async (event) => {
    event.preventDefault();
    setTimeError('');
    setTimeMessage('');

    if (!bulkTimeForm.user_ids.length) {
      setTimeError('請至少選擇一位人員。');
      return;
    }

    const startTime = toApiDatetimeValue(bulkTimeForm.start_time);
    const endTime = toApiDatetimeValue(bulkTimeForm.end_time);
    const hasHours = bulkTimeForm.work_hours.trim() !== '';
    const parsedHours = hasHours ? Number(bulkTimeForm.work_hours) : null;

    if (!startTime && !endTime && parsedHours === null) {
      setTimeError('請提供開始/結束時間或工時。');
      return;
    }
    if (hasHours && Number.isNaN(parsedHours)) {
      setTimeError('工時必須是數字。');
      return;
    }

    setBulkTimeLoading(true);
    try {
      await api.post(`tasks/${id}/time/manual`, {
        user_ids: bulkTimeForm.user_ids.map(Number),
        start_time: startTime || null,
        end_time: endTime || null,
        work_hours: parsedHours,
        note: bulkTimeForm.note.trim() || null,
      });
      setTimeMessage('已為選取人員建立多人工時紀錄。');
      setBulkTimeForm((prev) => ({
        ...prev,
        start_time: '',
        end_time: '',
        work_hours: '',
        note: '',
      }));
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '建立多人工時紀錄失敗。');
      setTimeError(message);
    } finally {
      setBulkTimeLoading(false);
    }
  };

  const handleStartEditTimeEntry = (entry) => {
    if (!entry?.id) return;
    setEditingTimeEntryId(entry.id);
    setEditingTimeForm({
      user_id: entry.user_id ? String(entry.user_id) : '',
      start_time: toInputDatetimeValue(entry.start_time),
      end_time: toInputDatetimeValue(entry.end_time),
      work_hours:
        entry.work_hours === null || entry.work_hours === undefined ? '' : String(entry.work_hours),
      note: entry.note || '',
    });
    setTimeError('');
    setTimeMessage('');
  };

  const handleEditingTimeChange = (event) => {
    const { name, value } = event.target;
    setEditingTimeForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCancelEditTimeEntry = () => {
    setEditingTimeEntryId(null);
    setEditingTimeForm({
      user_id: '',
      start_time: '',
      end_time: '',
      work_hours: '',
      note: '',
    });
  };

  const handleSaveEditTimeEntry = async (event) => {
    event.preventDefault();
    if (!editingTimeEntryId) return;
    setTimeError('');
    setTimeMessage('');
    setEditingTimeLoading(true);
    try {
      const payload = {
        user_id: editingTimeForm.user_id ? Number(editingTimeForm.user_id) : null,
        start_time: editingTimeForm.start_time ? toApiDatetimeValue(editingTimeForm.start_time) : null,
        end_time: editingTimeForm.end_time ? toApiDatetimeValue(editingTimeForm.end_time) : null,
        note: editingTimeForm.note.trim() || null,
      };
      if (editingTimeForm.work_hours.trim() !== '') {
        const parsed = Number(editingTimeForm.work_hours);
        if (Number.isNaN(parsed)) {
          throw new Error('工時必須是數字。');
        }
        payload.work_hours = parsed;
      }
      await api.patch(`tasks/${id}/time/${editingTimeEntryId}`, payload);
      setTimeMessage('工時紀錄已更新。');
      handleCancelEditTimeEntry();
      await loadTask();
    } catch (err) {
      const message = err?.message || getErrorMessage(err, '更新工時紀錄失敗。');
      setTimeError(message);
    } finally {
      setEditingTimeLoading(false);
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
      throw new Error('無法建立畫布進行壓縮');
    }
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('壓縮失敗'));
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
      setError('照片壓縮失敗，請重新選擇檔案。');
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
      const message = getErrorMessage(err, '上傳照片失敗。');
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
      const message = getErrorMessage(err, '上傳語音失敗。');
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
      const message = getErrorMessage(err, '上傳簽名失敗。');
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
      setTimeMessage('工時紀錄已開始。');
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '無法開始工時紀錄。');
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
      setTimeMessage('工時紀錄已結束。');
      await loadTask();
    } catch (err) {
      const message = getErrorMessage(err, '無法結束工時紀錄。');
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
      const message = getErrorMessage(err, '接單失敗。');
      setError(message);
    } finally {
      setAcceptingTask(false);
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
        <button type="button" className="secondary-button" onClick={loadTask}>
          重試
        </button>
        <button type="button" onClick={() => navigate(-1)}>
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="page task-detail-page mobile-tabs">
      <AppHeader title={task.title} subtitle={`任務編號：${task.id}`}>
        <Link to="/app" className="link-button">
          ← 返回任務列表
        </Link>
      </AppHeader>
      <header className="mobile-task-detail-header">
        <Link to="/app" className="mobile-task-back">‹</Link>
        <div>
          <span>TaskGo 現場版</span>
          <strong>{task.title}</strong>
        </div>
        <span className={statusBadgeClass[task.status] || 'status-badge'}>{task.status}</span>
      </header>
      {error && (
        <div className="error-text" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={loadTask}>
            重試
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
            <h2>任務資訊</h2>
            <p>
              狀態：
              <span className={statusBadgeClass[task.status] || 'status-badge'}>
                ● {task.status}
              </span>
              {showOverdueIndicator && (
                <span className="status-badge status-overdue">⚠️ 逾期</span>
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={showOverdue}
                onChange={(event) => setShowOverdue(event.target.checked)}
              />
              顯示逾期提醒
            </label>
            <div className="info-quick-actions">
              <div className="info-quick-actions__buttons">
                {canAcceptTask && (
                  <button type="button" onClick={handleAcceptTask} disabled={acceptingTask}>
                    {acceptingTask ? '接單中…' : '接單'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStartTime}
                  disabled={!!activeEntry || timeLoading}
                >
                  {activeEntry ? '已開始' : '開始工時'}
                </button>
                <button type="button" onClick={handleStopTime} disabled={!activeEntry || timeLoading}>
                  結束工時
                </button>
              </div>
              {timeError && <p className="error-text">{timeError}</p>}
              {timeMessage && <p className="success-text">{timeMessage}</p>}
              {activeEntry && (
                <p className="hint-text">
                  工時進行中（開始於 {formatDateTime(activeEntry.start_time)}）
                </p>
              )}
            </div>
            <div>
              <strong>指派對象：</strong>
              {task.assignees && task.assignees.length > 0 ? (
                <div className="chip-list">
                  {task.assignees.map((assignee) => (
                    <span key={assignee.id} className="chip">
                      {assignee.username}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="hint-text">未指派</span>
              )}
            </div>
            <p>建立人：{task.assigned_by || '系統'}</p>
            <p>內容：{task.description || '沒有描述'}</p>
            <p>地點：{task.location}</p>
            {task.location_url && (
              <p>
                地圖連結：
                <a href={task.location_url} target="_blank" rel="noreferrer">
                  {task.location_url}
                </a>
              </p>
            )}
            <p>預計完成時間：{formatDateTime(task.expected_time)}</p>
            <p>實際完成時間：{task.completed_at ? formatDateTime(task.completed_at) : '未完成'}</p>
            <p>總工時：{formatHours(task.total_work_hours)} 小時</p>
            {task.due_date && (
              <p>
                截止日期：{formatDateTime(task.due_date)}
                {showOverdueIndicator && <span className="hint-text">（已逾期）</span>}
              </p>
            )}
          </section>

          {canManageAssignmentPanel && (
            <section className="panel">
              <h2>{isManager ? '派工設定' : '現場補派工'}</h2>
              {assignmentError && <p className="error-text">{assignmentError}</p>}
              {assignmentSuccess && <p className="success-text">{assignmentSuccess}</p>}
              {!isManager && (
                <p className="hint-text">已派工人員可在現場補加漏派人員，既有指派名單會保留。</p>
              )}
              <form className="stack" onSubmit={handleAssignmentSubmit}>
                <label>
                  指派對象
                  <Select
                    isMulti
                    classNamePrefix="assignee-select"
                    placeholder="選擇要加入的人員"
                    options={assigneeOptions}
                    value={assigneeOptions.filter((option) =>
                      assignmentForm.assignee_ids.includes(option.value),
                    )}
                    onChange={handleAssigneeSelect}
                    isClearable
                    closeMenuOnSelect={false}
                  />
                </label>
                {isManager && (
                  <>
                    <label>
                      截止日期
                      <input
                        type="datetime-local"
                        name="due_date"
                        value={assignmentForm.due_date}
                        onChange={handleAssignmentChange}
                      />
                    </label>
                    <label>
                      地圖連結
                      <input
                        type="url"
                        name="location_url"
                        value={assignmentForm.location_url}
                        onChange={handleAssignmentChange}
                        placeholder="Google 地圖連結"
                      />
                    </label>
                  </>
                )}
                <button type="submit">{isManager ? '儲存派工' : '新增人員'}</button>
              </form>
            </section>
          )}

          <section className="panel">
            <h2>狀態更新與回報</h2>
            {task.updates.length === 0 ? (
              <p>尚無回報。</p>
            ) : (
              <ul className="updates">
                {task.updates.map((update) => {
                  const isAssigneeChange = update.status === '指派變更';
                  const assigneeSummary = isAssigneeChange
                    ? formatAssigneeChangeSummary(update.note)
                    : null;

                  return (
                    <li key={update.id}>
                      <p>
                        <strong>{update.author || '系統'}</strong> -{' '}
                        {formatDateTime(update.created_at)}
                      </p>
                      {update.status && <p>狀態：{update.status}</p>}
                      {isAssigneeChange && <p>{assigneeSummary}</p>}
                      {update.note && !isAssigneeChange && <p>備註：{update.note}</p>}
                      {(update.start_time || update.end_time) && (
                        <p>
                          工時：
                          {update.start_time ? formatDateTime(update.start_time) : '未記錄'} →
                          {update.end_time ? formatDateTime(update.end_time) : '進行中'} （
                          {formatHours(update.work_hours)} 小時）
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="stack" onSubmit={handleStatusSubmit}>
              <label>
                狀態
                <select name="status" value={updateForm.status} onChange={handleUpdateChange}>
                  <option value="">選擇狀態</option>
                  {availableStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                備註
                <textarea
                  ref={noteInputRef}
                  name="note"
                  value={updateForm.note}
                  onChange={handleUpdateChange}
                  placeholder="填寫回報內容"
                />
              </label>
              {noteTemplates.length > 0 && (
                <div className="note-template-picker">
                  <p className="hint-text">常用備註快速選單</p>
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
              <button type="submit">送出回報</button>
            </form>
          </section>
        </>
      )}

      {activeTab === 'photos' && (
        <section className="panel">
          <h2>📷 照片紀錄</h2>
          {latestPhotoAttachment && (
            <div className="attachment-preview">
              <p>最新照片</p>
              <figure>
                <img
                  src={latestPhotoAttachment.url}
                  alt={latestPhotoAttachment.original_name}
                />
                <figcaption>
                  {latestPhotoAttachment.original_name}
                  {latestPhotoAttachment.note && <span>（{latestPhotoAttachment.note}）</span>}
                </figcaption>
              </figure>
            </div>
          )}
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
              <input
                ref={photoFileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoFileChange}
              />
            </label>
            {photoProcessing && <p className="hint-text">照片處理中…</p>}
            {photoPreviewUrl && photoPreviewMeta && (
              <div className="attachment-preview">
                <p>
                  壓縮後預覽：<strong>{photoPreviewMeta.name}</strong>{' '}
                  <span>
                    （
                    {photoPreviewMeta.size
                      ? `${(photoPreviewMeta.size / 1024).toFixed(1)} KB`
                      : '大小未知'}
                    ，原始檔
                    {photoPreviewMeta.originalSize
                      ? `${(photoPreviewMeta.originalSize / 1024).toFixed(1)} KB`
                      : '未知'}
                    ）
                  </span>
                </p>
                <img src={photoPreviewUrl} alt="上傳照片預覽" />
              </div>
            )}
            <button type="submit" disabled={!photoForm.file || uploadingPhoto || photoProcessing}>
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

      {activeTab === 'materials' && (
        <TaskMaterialsPanel
          taskId={Number(id)}
          taskStatus={task?.status || ''}
          taskCompletedAt={task?.completed_at || null}
        />
      )}

      {activeTab === 'time' && (
        <section className="panel">
          <h2>工時紀錄</h2>
          {timeError && <p className="error-text">{timeError}</p>}
          {timeMessage && <p className="success-text">{timeMessage}</p>}
          <p>
            總工時：<strong>{formatHours(task.total_work_hours)} 小時</strong>
          </p>
          <div className="time-actions">
            <button type="button" onClick={handleStartTime} disabled={!!activeEntry || timeLoading}>
              {activeEntry ? '已開始' : '開始工時'}
            </button>
            <button type="button" onClick={handleStopTime} disabled={!activeEntry || timeLoading}>
              結束工時
            </button>
          </div>
          {activeEntry && (
            <p className="hint-text">工時計時中（開始於 {formatDateTime(activeEntry.start_time)}）</p>
          )}

          {canManageMultiTime && (
            <form className="stack" onSubmit={handleBulkTimeSubmit}>
              <h3>多人共用工時</h3>
              <label>
                人員（可複選）
                <Select
                  isMulti
                  classNamePrefix="assignee-select"
                  placeholder="選擇已指派人員"
                  options={timeTargetOptions}
                  value={timeTargetOptions.filter((option) =>
                    bulkTimeForm.user_ids.includes(option.value),
                  )}
                  onChange={handleBulkTimeUsersChange}
                  closeMenuOnSelect={false}
                />
              </label>
              <label>
                開始時間
                <input type="datetime-local" name="start_time" value={bulkTimeForm.start_time} onChange={handleBulkTimeChange} />
              </label>
              <label>
                結束時間
                <input type="datetime-local" name="end_time" value={bulkTimeForm.end_time} onChange={handleBulkTimeChange} />
              </label>
              <label>
                工時（選填）
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="work_hours"
                  value={bulkTimeForm.work_hours}
                  onChange={handleBulkTimeChange}
                  placeholder="例如 7.5"
                />
              </label>
              <label>
                備註
                <input name="note" value={bulkTimeForm.note} onChange={handleBulkTimeChange} placeholder="選填備註" />
              </label>
              <button type="submit" disabled={bulkTimeLoading}>
                {bulkTimeLoading ? '儲存中...' : '建立多人工時紀錄'}
              </button>
            </form>
          )}

          {timeEntries.length === 0 ? (
            <p>目前尚無工時紀錄。</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>人員</th>
                  <th>開始</th>
                  <th>結束</th>
                  <th>工時</th>
                  {isManager && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {timeEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.author || `人員 #${entry.user_id}`}</td>
                    <td>{entry.start_time ? formatDateTime(entry.start_time) : '-'}</td>
                    <td>{entry.end_time ? formatDateTime(entry.end_time) : '進行中'}</td>
                    <td>{formatHours(entry.work_hours)}</td>
                    {isManager && (
                      <td>
                        <button type="button" className="secondary-button" onClick={() => handleStartEditTimeEntry(entry)}>
                          編輯
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isManager && editingTimeEntryId && (
            <form className="stack" onSubmit={handleSaveEditTimeEntry}>
              <h3>編輯工時紀錄 #{editingTimeEntryId}</h3>
              <label>
                人員
                <select name="user_id" value={editingTimeForm.user_id} onChange={handleEditingTimeChange}>
                  <option value="">未指定</option>
                  {timeTargetOptions.map((option) => (
                    <option key={option.value} value={String(option.value)}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                開始時間
                <input type="datetime-local" name="start_time" value={editingTimeForm.start_time} onChange={handleEditingTimeChange} />
              </label>
              <label>
                結束時間
                <input type="datetime-local" name="end_time" value={editingTimeForm.end_time} onChange={handleEditingTimeChange} />
              </label>
              <label>
                工時
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="work_hours"
                  value={editingTimeForm.work_hours}
                  onChange={handleEditingTimeChange}
                  placeholder="留空時自動重新計算"
                />
              </label>
              <label>
                備註
                <input name="note" value={editingTimeForm.note} onChange={handleEditingTimeChange} />
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="submit" disabled={editingTimeLoading}>
                  {editingTimeLoading ? '儲存中...' : '儲存工時紀錄'}
                </button>
                <button type="button" className="secondary-button" onClick={handleCancelEditTimeEntry}>取消</button>
              </div>
            </form>
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
