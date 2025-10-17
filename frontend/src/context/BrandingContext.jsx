import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../api/client.js';

const defaultBranding = {
  name: '立翔水電行',
  logoUrl: null,
  logoPath: null,
  logoUpdatedAt: null,
};

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
  logoUrl: data.logo_url ?? null,
  logoPath: data.logo_path ?? null,
  logoUpdatedAt: data.logo_updated_at ?? null,
});

export const BrandingProvider = ({ children }) => {
  const [branding, setBranding] = useState(defaultBranding);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/branding');
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
    refresh().catch(() => {
      // Branding 可以維持預設值
    });
  }, [refresh]);

  const updateName = useCallback(
    async (name) => {
      const trimmed = (name || '').trim();
      const { data } = await api.put('/settings/branding/name', { name: trimmed });
      const payload = normaliseBranding(data);
      setBranding(payload);
      return payload;
    },
    [],
  );

  const uploadLogo = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/settings/branding/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const payload = normaliseBranding(data);
    setBranding(payload);
    return payload;
  }, []);

  const removeLogo = useCallback(async () => {
    const { data } = await api.delete('/settings/branding/logo');
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

