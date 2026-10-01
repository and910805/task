import { useEffect, useRef, useState } from 'react';
import { ArrowUpToLine, Download, RotateCcw, Save, X } from 'lucide-react';
import api from '../api/client.js';
import './StampPreview.css';

const png = (value) => `data:image/png;base64,${value}`;

export default function StampPreview({ document, onClose }) {
  const dialog = useRef(null);
  const surface = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);
  const [requestedPage, setPage] = useState(null);
  const [data, setData] = useState(null);
  const [position, setPosition] = useState(null);
  const [mode, setMode] = useState('auto');
  const [requestedCompact, setCompact] = useState(null);
  const [retry, setRetry] = useState(0);
  const [slow, setSlow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const base = `crm/${document.kind}/${document.id}`;
  const page = data?.page || requestedPage || 1;
  const compact = requestedCompact ?? data?.compact ?? false;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSlow(false);
    setError('');
    const slowTimer = window.setTimeout(() => setSlow(true), 8000);
    api.get(`${base}/stamp-preview`, { params: {
      ...(requestedPage === null ? {} : { page: requestedPage }),
      ...(requestedCompact === null ? {} : { compact: requestedCompact ? '1' : '0' }),
    }, signal: controller.signal, timeout: 30000, readRetries: 0 })
      .then(({ data: next }) => {
        if (controller.signal.aborted) return;
        setData(next);
        if (initialized.current) {
          setPosition((old) => old && (old.page > next.pages && !next.automatic.disabled
            ? { page: next.automatic.target_page, x: next.automatic.center_x, y: next.automatic.center_y }
            : { ...old, page: Math.min(old.page, next.pages) }));
        }
        if (!initialized.current) {
          initialized.current = true;
          setMode(next.saved ? 'manual' : 'auto');
          const saved = next.saved && { ...next.saved, page: Math.min(next.pages, Math.max(1, next.saved.page)) };
          setPosition(saved || { page: next.automatic.target_page || 1,
            x: next.automatic.center_x || next.width * 0.75,
            y: next.automatic.center_y || next.height * 0.2 });
        }
      })
      .catch((e) => { if (!controller.signal.aborted) setError(
        e.response?.status === 401 ? '登入已過期，請重新登入。' : e.networkMessage || e.response?.data?.msg || '預覽載入失敗，請重試。'); })
      .finally(() => { window.clearTimeout(slowTimer); if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); window.clearTimeout(slowTimer); };
  }, [base, requestedPage, requestedCompact, retry]);

  const automatic = data?.automatic;
  const active = mode === 'manual' ? position : automatic && !automatic.disabled
    ? { page: automatic.target_page, x: automatic.center_x, y: automatic.center_y } : null;
  const stamp = data?.stamp;
  let collision = '';
  if (mode === 'manual' && active && stamp && data?.page === active.page) {
    const box = [active.x - stamp.width / 2, active.y - stamp.height / 2,
      active.x + stamp.width / 2, active.y + stamp.height / 2];
    let covered = 0;
    for (const row of data.rows) {
      const [left, bottom, , top] = row.cells[0].box;
      const right = row.cells.at(-1).box[2];
      if (box[0] >= left && box[2] <= right) covered += Math.max(0, Math.min(top, box[3]) - Math.max(bottom, box[1]));
      if (row.cells.some(({ box: [a, b, c, d], protected: blocked }) =>
        blocked && box[0] < c && box[2] > a && box[1] < d && box[3] > b)) collision = '印章會遮住文字或非零金額。';
    }
    if (covered < stamp.height - 0.01) collision = '印章超出表格明細區。';
  }

  function move(event) {
    if (mode !== 'manual' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = surface.current.getBoundingClientRect();
    setPosition({ page, x: (event.clientX - rect.left) / rect.width * data.width - dragOffset.current.x,
      y: (1 - (event.clientY - rect.top) / rect.height) * data.height - dragOffset.current.y });
    setMessage('');
  }

  async function save(download = false) {
    setSaving(true); setError(''); setMessage('');
    try {
      await api.put(`${base}/stamp-position`, mode === 'auto' ? { mode } :
        { ...position, mode, compact: Boolean(compact), fingerprint: data.fingerprint });
      setMessage('已儲存');
      if (download) {
        const response = await api.get(`${base}/pdf`, { responseType: 'blob', timeout: 60000, readRetries: 0 });
        const url = URL.createObjectURL(response.data);
        const link = window.document.createElement('a');
        link.href = url; link.download = `${document.label}.pdf`;
        dialog.current.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) {
      let detail = e.response?.data;
      if (detail instanceof Blob) { try { detail = JSON.parse(await detail.text()); } catch { detail = null; } }
      setError(detail?.msg || '儲存或下載失敗，請稍後再試。');
    } finally { setSaving(false); }
  }

  const disabled = loading || saving || !data || Boolean(error) || (mode === 'manual' && (!stamp || collision || active?.page !== page));
  return <dialog ref={dialog} className="stamp-dialog" onCancel={(e) => { if (saving) e.preventDefault(); else onClose(); }}>
    <header className="stamp-toolbar">
      <h2>印章位置 <small>{document.label}</small></h2>
      <button type="button" title="關閉" aria-label="關閉" disabled={saving} onClick={onClose}><X size={20} /></button>
    </header>
    <div className="stamp-toolbar">
      <fieldset disabled={loading || saving || !stamp}>
        <label><input type="radio" name="stamp-mode" checked={mode === 'auto'} onChange={() => { setMode('auto'); setCompact(false); setMessage(''); }} />自動</label>
        <label><input type="radio" name="stamp-mode" checked={mode === 'manual'} onChange={() => {
          setMode('manual'); setPosition({ page, x: active?.x || data.width * 0.75, y: active?.y || data.height * 0.2 });
        }} />手動</label>
      </fieldset>
      <label>頁碼 <select aria-label="頁碼" value={page} disabled={loading || saving} onChange={(e) => {
        const next = Number(e.target.value); setPage(next);
        if (mode === 'manual') setPosition((old) => ({ ...old, page: next }));
      }}>{Array.from({ length: data?.pages || 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <span>共 {data?.pages ?? '-'} 頁</span>
      <button type="button" title="印章移到第一頁" aria-label="印章移到第一頁" disabled={loading || saving || !stamp} onClick={() => {
        setMode('manual'); setPage(1); setPosition({ page: 1, x: active?.x || data.width * 0.75, y: active?.y || data.height * 0.2 }); setMessage('');
      }}><ArrowUpToLine size={18} /></button>
      <label><input type="checkbox" checked={Boolean(compact)} disabled={loading || saving || !stamp} onChange={(e) => {
        setCompact(e.target.checked); setMode('manual'); setPosition({ ...active, page }); setMessage('');
      }} />移除蓋章預留空白頁</label>
      <button type="button" title="恢復自動" aria-label="恢復自動" disabled={loading || saving} onClick={() => { setMode('auto'); setCompact(false); setMessage(''); }}><RotateCcw size={18} /></button>
      <span className="stamp-status" role="status">{loading ? (slow ? '產生預覽較久，最長等待 30 秒…' : '載入中…') : saving ? '儲存中…' : message}</span>
      {!loading && error && <button type="button" title="重新載入預覽" aria-label="重新載入預覽" disabled={saving} onClick={() => setRetry((value) => value + 1)}><RotateCcw size={18} /></button>}
      <button type="button" disabled={disabled} onClick={() => save(false)}><Save size={18} />儲存</button>
      <button type="button" disabled={disabled} onClick={() => save(true)}><Download size={18} />儲存並下載</button>
    </div>
    <p className="stamp-warning" role="status">{error || collision || (data?.warning && !message ? data.warning : '') || (!loading && data && !stamp ? '此公司尚未設定印章。' : '')}</p>
    <div className="stamp-scroll" aria-busy={loading}>
      {data && !loading && <div ref={surface} className="stamp-sheet" style={{ aspectRatio: `${data.width} / ${data.height}` }}>
        <img className="stamp-page" src={png(data.image)} alt={`單據第 ${page} 頁`} draggable={false} />
        {stamp && active?.page === page && <button type="button" className={`stamp-handle ${collision ? 'is-invalid' : ''}`}
          aria-label="印章位置" title="印章位置" disabled={mode !== 'manual' || saving}
          style={{ left: `${active.x / data.width * 100}%`, top: `${(1 - active.y / data.height) * 100}%`,
            width: `${stamp.width / data.width * 100}%`, height: `${stamp.height / data.height * 100}%` }}
          onPointerDown={(e) => {
            const rect = surface.current.getBoundingClientRect();
            dragOffset.current = { x: (e.clientX - rect.left) / rect.width * data.width - active.x,
              y: (1 - (e.clientY - rect.top) / rect.height) * data.height - active.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={move}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          onKeyDown={(e) => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
            if (!delta) return; e.preventDefault();
            setPosition((old) => ({ ...old, x: old.x + delta[0] * (e.shiftKey ? 10 : 1), y: old.y + delta[1] * (e.shiftKey ? 10 : 1) }));
            setMessage('');
          }}><img src={png(data.stamp_image)} alt="公司印章" draggable={false} /></button>}
      </div>}
    </div>
  </dialog>;
}
