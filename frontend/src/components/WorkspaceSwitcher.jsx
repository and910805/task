import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';

import { useAuth } from '../context/AuthContext.jsx';
import { useBranding } from '../context/BrandingContext.jsx';
import { landingPathFor } from '../constants/workspace.js';

// Shows which company the user is working in; switching is always explicit.
const WorkspaceSwitcher = () => {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, switchWorkspace } = useAuth();
  const { branding } = useBranding();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = async (workspace) => {
    setOpen(false);
    if (workspace.id === activeWorkspace?.id) return;
    setBusy(true);
    try {
      const session = await switchWorkspace(workspace.id);
      toast.success(`已切換到 ${workspace.name}`);
      navigate(landingPathFor(session), { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.msg || err?.networkMessage || '切換公司失敗');
    } finally {
      setBusy(false);
    }
  };

  const name = activeWorkspace?.name || branding.name || 'TaskGo';

  return (
    <div className="tg-switcher" ref={rootRef}>
      <button
        type="button"
        className="tg-switcher__button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
      >
        <Building2 aria-hidden="true" />
        <span className="tg-switcher__name">{name}</span>
        {activeWorkspace ? <span className="tg-switcher__role">{activeWorkspace.role_label}</span> : null}
        <ChevronsUpDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="tg-switcher__menu" role="menu" aria-label="切換公司">
          {workspaces.map((workspace) => (
            <button
              type="button"
              role="menuitem"
              key={workspace.id}
              className={`tg-switcher__item${workspace.id === activeWorkspace?.id ? ' is-active' : ''}`}
              onClick={() => choose(workspace)}
            >
              <span>
                {workspace.name}
                <br />
                <small className="tg-hint">{workspace.role_label}</small>
              </span>
              {workspace.id === activeWorkspace?.id ? <Check aria-label="目前公司" /> : null}
            </button>
          ))}
          <div className="tg-switcher__divider" />
          <Link to="/onboarding" role="menuitem" className="tg-switcher__item" onClick={() => setOpen(false)}>
            <span>加入或建立公司</span>
            <Plus aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </div>
  );
};

export default WorkspaceSwitcher;
