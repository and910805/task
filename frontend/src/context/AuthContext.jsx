import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../api/client.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('auth_user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const persistUser = useCallback((nextUser) => {
    if (nextUser) {
      localStorage.setItem('auth_user', JSON.stringify(nextUser));
      setUser(nextUser);
    } else {
      localStorage.removeItem('auth_user');
      setUser(null);
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

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      if (!token) {
        persistUser(null);
        setInitializing(false);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        if (!active) return;
        persistUser(data);
      } catch (error) {
        if (!active) return;
        persistToken(null);
        persistUser(null);
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [token, persistToken, persistUser]);

  const login = useCallback(
    async (credentials) => {
      setLoading(true);
      try {
        const { data } = await api.post('/auth/login', credentials);
        persistToken(data.token);
        persistUser(data.user);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [persistToken, persistUser],
  );

  const register = useCallback(async (payload) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        ...payload,
        role: 'worker',
      });
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    persistToken(null);
    persistUser(null);
    window.location.href = '/login';
  }, [persistToken, persistUser]);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      persistUser(data);
      return data;
    } catch (error) {
      persistToken(null);
      persistUser(null);
      throw error;
    }
  }, [persistToken, persistUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      initializing,
      token,
      isAuthenticated: Boolean(user),
      login,
      logout,
      register,
      refreshUser,
    }),
    [
      user,
      loading,
      initializing,
      token,
      login,
      logout,
      register,
      refreshUser,
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
