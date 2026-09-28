import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import api, {
  AUTH_EXPIRED_EVENT,
  WORKSPACE_ACCESS_EVENT,
  WORKSPACE_STORAGE_KEY,
} from '../api/client.js';
import { unregisterPushToken } from '../native/push.js';

export const WORKSPACE_CHANGED_EVENT = 'taskgo:workspace-changed';
export const SESSION_NOTICE_KEY = 'taskgo_session_notice';
// Tokens expire after an hour; renew well before that while the app is open.
const TOKEN_REFRESH_MS = 30 * 60 * 1000;

const AuthContext = createContext(null);

const readStoredUser = () => {
  try {
    const stored = localStorage.getItem('auth_user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

const announceWorkspaceChange = () => {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT));
};

// Server payloads come as { user, workspaces, active_workspace_id } (login,
// signup, switch) or as a flat user with those fields (auth/me).
const mergeSession = (payload) => {
  if (!payload) return null;
  const base = payload.user ? { ...payload.user } : { ...payload };
  base.workspaces = payload.workspaces ?? base.workspaces ?? [];
  base.active_workspace_id = payload.active_workspace_id ?? base.active_workspace_id ?? null;
  return base;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(readStoredUser);
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const lastWorkspaceRef = useRef(localStorage.getItem(WORKSPACE_STORAGE_KEY));

  const persistUser = useCallback((nextUser) => {
    if (nextUser) {
      localStorage.setItem('auth_user', JSON.stringify(nextUser));
      setUser(nextUser);
      const workspaceId = nextUser.active_workspace_id ? String(nextUser.active_workspace_id) : null;
      if (workspaceId) {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
      } else {
        localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      }
      if (lastWorkspaceRef.current !== workspaceId) {
        lastWorkspaceRef.current = workspaceId;
        announceWorkspaceChange();
      }
    } else {
      localStorage.removeItem('auth_user');
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      lastWorkspaceRef.current = null;
      setUser(null);
      announceWorkspaceChange();
    }
  }, []);

  const persistToken = useCallback((nextToken) => {
    if (nextToken) {
      localStorage.setItem('auth_token', nextToken);
      setToken(nextToken);
    } else {
      localStorage.removeItem('auth_token');
      setToken(null);
    }
  }, []);

  const applySession = useCallback(
    (payload) => {
      if (payload?.token) persistToken(payload.token);
      const merged = mergeSession(payload);
      persistUser(merged);
      return merged;
    },
    [persistToken, persistUser],
  );

  const clearSession = useCallback(
    (notice) => {
      if (notice) {
        try {
          sessionStorage.setItem(SESSION_NOTICE_KEY, notice);
        } catch {
          // sessionStorage may be unavailable (private mode); the notice is optional.
        }
      }
      persistToken(null);
      persistUser(null);
    },
    [persistToken, persistUser],
  );

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      if (!token) {
        if (user) persistUser(null);
        setInitializing(false);
        return;
      }
      try {
        const { data } = await api.get('auth/me');
        if (!active) return;
        persistUser(mergeSession(data));
      } catch (error) {
        if (!active) return;
        // Offline at launch: keep the cached session instead of logging out.
        if (error?.response?.status === 401) {
          clearSession('登入已過期，請重新登入。');
        } else if (!error?.response && user) {
          // keep cached user; pages will show their own network errors
        } else {
          clearSession();
        }
      } finally {
        if (active) setInitializing(false);
      }
    };

    initialize();

    return () => {
      active = false;
    };
    // Only re-run when the token itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Keep the session alive while the app is open.
  useEffect(() => {
    if (!token) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.post('auth/refresh');
        applySession(data);
      } catch {
        // A 401 is handled by the expiry listener below.
      }
    }, TOKEN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [token, applySession]);

  useEffect(() => {
    const onExpired = () => {
      clearSession('登入已過期，請重新登入。');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    };
    const onWorkspaceAccess = () => {
      // Removed from the company or switched elsewhere: reload memberships.
      api
        .get('auth/me', { skipWorkspace: true })
        .then(({ data }) => persistUser(mergeSession(data)))
        .catch(() => {});
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(WORKSPACE_ACCESS_EVENT, onWorkspaceAccess);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener(WORKSPACE_ACCESS_EVENT, onWorkspaceAccess);
    };
  }, [clearSession, persistUser]);

  const withLoading = useCallback(async (fn) => {
    setLoading(true);
    try {
      return await fn();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    (credentials) =>
      withLoading(async () => {
        localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        const { data } = await api.post('auth/login', credentials, { skipAuthExpiry: true });
        return applySession(data);
      }),
    [applySession, withLoading],
  );

  const signup = useCallback(
    (payload) =>
      withLoading(async () => {
        localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        const { data } = await api.post('auth/signup', payload, { skipAuthExpiry: true });
        return applySession(data);
      }),
    [applySession, withLoading],
  );

  const registerWithInvite = useCallback(
    (payload) =>
      withLoading(async () => {
        localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        const { data } = await api.post('auth/register', payload, { skipAuthExpiry: true });
        return applySession(data);
      }),
    [applySession, withLoading],
  );

  const switchWorkspace = useCallback(
    async (workspaceId) => {
      const { data } = await api.post(`workspaces/${workspaceId}/activate`, {}, { skipWorkspace: true });
      return applySession(data);
    },
    [applySession],
  );

  const createWorkspace = useCallback(
    async (payload) => {
      const { data } = await api.post('workspaces/', payload, { skipWorkspace: true });
      return applySession(data);
    },
    [applySession],
  );

  const joinWorkspace = useCallback(
    async (code) => {
      const { data } = await api.post('workspaces/join', { code }, { skipWorkspace: true });
      return applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    // Stop pushes to this device before the token is discarded.
    await unregisterPushToken();
    api.post('auth/logout').catch(() => {});
    clearSession();
    window.location.href = '/login';
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const { data } = await api.get('auth/me');
    return persistUser(mergeSession(data)) ?? mergeSession(data);
  }, [persistUser]);

  const workspaces = useMemo(() => user?.workspaces ?? [], [user]);
  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === user?.active_workspace_id) ?? null,
    [workspaces, user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      initializing,
      token,
      isAuthenticated: Boolean(user),
      workspaces,
      activeWorkspace,
      hasModule: (name) => Boolean(activeWorkspace?.modules?.[name]),
      login,
      signup,
      registerWithInvite,
      logout,
      refreshUser,
      switchWorkspace,
      createWorkspace,
      joinWorkspace,
      clearSession,
    }),
    [
      user,
      loading,
      initializing,
      token,
      workspaces,
      activeWorkspace,
      login,
      signup,
      registerWithInvite,
      logout,
      refreshUser,
      switchWorkspace,
      createWorkspace,
      joinWorkspace,
      clearSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
