import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

import api from '../api/client.js';

const TOKEN_KEY = 'taskgo_push_token';

export const isNativeApp = () => Capacitor.isNativePlatform();

export const pushSupported = () => isNativeApp() && Capacitor.isPluginAvailable('PushNotifications');

export const storedPushToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const pushPermissionState = async () => {
  if (!pushSupported()) return 'unsupported';
  const { receive } = await PushNotifications.checkPermissions();
  return receive; // 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
};

// Registration result arrives through the 'registration' listener below.
export const requestPushPermission = async () => {
  if (!pushSupported()) return 'unsupported';
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive === 'granted') {
    await PushNotifications.register();
  }
  return receive;
};

export const attachPushListeners = ({ onOpenTask }) => {
  if (!pushSupported()) return () => {};
  const handles = [];
  const add = (event, handler) => {
    PushNotifications.addListener(event, handler).then((handle) => handles.push(handle));
  };
  add('registration', async ({ value }) => {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // storage unavailable: the token is re-sent on the next launch anyway
    }
    await api.post('workspaces/devices', { token: value, platform: 'ios' }, { skipWorkspace: true }).catch(() => {});
  });
  add('pushNotificationActionPerformed', ({ notification }) => {
    const data = notification?.data || {};
    if (data.task_id) onOpenTask(String(data.task_id), data.workspace_id ? String(data.workspace_id) : null);
  });
  return () => handles.forEach((handle) => handle.remove());
};

// Called before logout so a shared device stops receiving this user's pushes.
export const unregisterPushToken = async () => {
  const token = storedPushToken();
  if (!token) return;
  await api.delete('workspaces/devices', { data: { token }, skipWorkspace: true }).catch(() => {});
};
