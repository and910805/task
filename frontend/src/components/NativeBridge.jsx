import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';

import { useAuth } from '../context/AuthContext.jsx';
import { attachPushListeners, isNativeApp, pushPermissionState, requestPushPermission } from '../native/push.js';

const ASKED_KEY = 'taskgo_push_asked';

// iOS app glue: push registration, notification taps, offline banner.
// Renders nothing in a normal browser except the offline banner.
const NativeBridge = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const signedIn = Boolean(user?.active_workspace_id);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    return attachPushListeners({
      onOpenTask: (taskId, workspaceId) => {
        navigate(workspaceId ? `/tasks/${taskId}?ws=${workspaceId}` : `/tasks/${taskId}`);
      },
    });
  }, [navigate]);

  // Ask once after the first sign-in into a company; afterwards re-register
  // silently so the server always has a fresh device token.
  useEffect(() => {
    if (!isNativeApp() || !signedIn) return;
    (async () => {
      const state = await pushPermissionState();
      let asked = false;
      try {
        asked = localStorage.getItem(ASKED_KEY) === '1';
      } catch {
        asked = false;
      }
      if (state === 'granted' || !asked) {
        try {
          localStorage.setItem(ASKED_KEY, '1');
        } catch {
          // ignore
        }
        await requestPushPermission().catch(() => {});
      }
    })();
  }, [signedIn, user?.id]);

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let handle;
    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const target = new URL(url);
        if (target.pathname.startsWith('/tasks/') || target.pathname.startsWith('/join')) {
          navigate(`${target.pathname}${target.search}`);
        }
      } catch {
        // ignore malformed links
      }
    }).then((value) => {
      handle = value;
    });
    return () => handle?.remove();
  }, [navigate]);

  if (online) return null;
  return (
    <div className="tg-offline-banner" role="status">
      目前離線：可以瀏覽已開啟的畫面，但接單、工時與照片需要網路才能送出。
    </div>
  );
};

export default NativeBridge;
