const UPDATE_EVENT = 'lixiang-pwa-update-ready';

const announceUpdate = (registration) => {
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: registration }));
};

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) {
        announceUpdate(registration);
      }

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate(registration);
          }
        });
      });
    }).catch(() => {
      // PWA installation is optional; the existing web app remains usable.
    });
  }, { once: true });
};

export const PWA_UPDATE_EVENT = UPDATE_EVENT;
