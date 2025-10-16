import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import { buildRoleOptions, defaultRoleLabels } from '../constants/roles.js';
import { useAuth } from './AuthContext.jsx';

const RoleLabelContext = createContext({
  labels: defaultRoleLabels,
  overrides: {},
  options: buildRoleOptions(),
  loading: false,
  refresh: () => Promise.resolve(),
  updateRoleLabel: () => Promise.resolve(),
  resetRoleLabel: () => Promise.resolve(),
});

export const RoleLabelProvider = ({ children }) => {
  const { token } = useAuth();
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/roles');
      const fetchedOverrides = data?.overrides ?? {};
      setOverrides(fetchedOverrides);
      return data;
    } catch (error) {
      setOverrides({});
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setOverrides({});
      return;
    }

    refresh().catch(() => {
      // 如果取得自訂角色名稱失敗，維持預設值即可。
    });
  }, [token, refresh]);

  const labels = useMemo(
    () => ({ ...defaultRoleLabels, ...overrides }),
    [overrides],
  );

  const options = useMemo(() => buildRoleOptions(labels), [labels]);

  const updateRoleLabel = useCallback(
    async (role, label) => {
      const trimmed = (label || '').trim();
      const { data } = await api.put(`/settings/roles/${role}`, { label: trimmed });
      const nextOverrides = data?.overrides ?? {};
      setOverrides(nextOverrides);
      return data;
    },
    [],
  );

  const resetRoleLabel = useCallback(
    async (role) => {
      const { data } = await api.delete(`/settings/roles/${role}`);
      const nextOverrides = data?.overrides ?? {};
      setOverrides(nextOverrides);
      return data;
    },
    [],
  );

  const value = useMemo(
    () => ({
      labels,
      overrides,
      options,
      loading,
      refresh,
      updateRoleLabel,
      resetRoleLabel,
    }),
    [labels, overrides, options, loading, refresh, updateRoleLabel, resetRoleLabel],
  );

  return <RoleLabelContext.Provider value={value}>{children}</RoleLabelContext.Provider>;
};

export const useRoleLabels = () => {
  const context = useContext(RoleLabelContext);
  if (!context) {
    throw new Error('useRoleLabels must be used within a RoleLabelProvider');
  }
  return context;
};
