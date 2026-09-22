import { useEffect, useState } from 'react';

import { PWA_UPDATE_EVENT } from '../pwa/registerServiceWorker.js';

function PwaUpdatePrompt() {
  const [waitingRegistration, setWaitingRegistration] = useState(null);
  const [updateQueued, setUpdateQueued] = useState(false);

  useEffect(() => {
    const showUpdate = (event) => setWaitingRegistration(event.detail);
    window.addEventListener(PWA_UPDATE_EVENT, showUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, showUpdate);
  }, []);

  useEffect(() => {
    if (!updateQueued) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setUpdateQueued(false), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [updateQueued]);

  const queueUpdate = () => {
    waitingRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    setUpdateQueued(true);
    setWaitingRegistration(null);
  };

  if (!waitingRegistration && !updateQueued) {
    return null;
  }

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <span>
        {updateQueued
          ? '新版會在您下次重新開啟 App 時套用。'
          : '立翔水電行已有新版可用。'}
      </span>
      {updateQueued ? (
        <button type="button" className="secondary-button" onClick={() => setUpdateQueued(false)}>
          關閉
        </button>
      ) : (
        <div className="pwa-update-actions">
          <button type="button" className="secondary-button" onClick={() => setWaitingRegistration(null)}>
            稍後
          </button>
          <button type="button" className="primary-button" onClick={queueUpdate}>
            下次開啟時更新
          </button>
        </div>
      )}
    </aside>
  );
}

export default PwaUpdatePrompt;
