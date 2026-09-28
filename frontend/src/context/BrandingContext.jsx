import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api, { resolveBackendUrl } from '../api/client.js';

const defaultBranding = {
  name: 'TaskGo',
  logoUrl: null,
  logoPath: null,
  logoUpdatedAt: null,
};

// 平台名固定為 TaskGo；登入後顯示目前公司的名稱與 Logo
const APP_NAME = 'TaskGo';
const FALLBACK_TITLE = 'TaskGo';
const WORKSPACE_CHANGED_EVENT = 'taskgo:workspace-changed';
const FALLBACK_FAVICON = '/brand-logo.svg';

const BrandingContext = createContext({
  branding: defaultBranding,
  loading: true,
  refresh: () => Promise.resolve(defaultBranding),
  updateName: () => Promise.resolve(defaultBranding),
  uploadLogo: () => Promise.resolve(defaultBranding),
  removeLogo: () => Promise.resolve(defaultBranding),
});

const normaliseBranding = (data = {}) => ({
  name: data.name || defaultBranding.name,
  workspaceId: data.workspace_id ?? null,
  logoUrl: resolveBackendUrl(data.logo_url) ?? null,
  logoPath: data.logo_path ?? null,
  logoUpdatedAt: data.logo_updated_at ?? null,
});

export const BrandingProvider = ({ children }) => {
  const [branding, setBranding] = useState(defaultBranding);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('settings/branding');
      const payload = normaliseBranding(data);
      setBranding(payload);
      return payload;
    } catch (error) {
      setBranding(defaultBranding);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = () =>
      refresh().catch(() => {
        // Branding 可以維持預設值
      });
    load();
    // Company branding follows login, logout and workspace switches.
    window.addEventListener(WORKSPACE_CHANGED_EVENT, load);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, load);
  }, [refresh]);

  // 分頁標題與 favicon 跟著品牌設定走
  useEffect(() => {
    const name = (branding.name || '').trim();
    document.title = name && name !== APP_NAME ? `${name}｜${APP_NAME}` : FALLBACK_TITLE;

    const icon = document.querySelector("link[rel='icon']");
    if (icon) {
      icon.href = branding.logoUrl || FALLBACK_FAVICON;
    }
  }, [branding.name, branding.logoUrl]);

  const updateName = useCallback(
    async (name) => {
      const trimmed = (name || '').trim();
      const { data } = await api.put('settings/branding/name', { name: trimmed });
      const payload = normaliseBranding(data);
      setBranding(payload);
      return payload;
    },
    [],
  );

  const uploadLogo = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('settings/branding/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const payload = normaliseBranding(data);
    setBranding(payload);
    return payload;
  }, []);

  const removeLogo = useCallback(async () => {
    const { data } = await api.delete('settings/branding/logo');
    const payload = normaliseBranding(data);
    setBranding(payload);
    return payload;
  }, []);

  const value = useMemo(
    () => ({
      branding,
      loading,
      refresh,
      updateName,
      uploadLogo,
      removeLogo,
    }),
    [branding, loading, refresh, updateName, uploadLogo, removeLogo],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};

