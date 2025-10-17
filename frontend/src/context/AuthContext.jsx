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
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const persistUser = useCallback((nextUser) => {
    localStorage.removeItem('auth_token');
    if (nextUser) {
      localStorage.setItem('auth_user', JSON.stringify(nextUser));
      setUser(nextUser);
    } else {
      localStorage.removeItem('auth_user');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        if (!active) return;
        persistUser(data.user);
      } catch (error) {
        if (!active) return;
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
  }, [persistUser]);

  const login = useCallback(
    async (credentials) => {
      setLoading(true);
      try {
        const { data } = await api.post('/auth/login', credentials);
        persistUser(data.user);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [persistUser],
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
    persistUser(null);
  }, [persistUser]);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.post('/auth/refresh');
      persistUser(data.user);
      return data.user;
    } catch (error) {
      persistUser(null);
      throw error;
    }
  }, [persistUser]);

  const value = useMemo(
    () => ({
      user,
      loading,
      initializing,
      isAuthenticated: Boolean(user),
      login,
      logout,
      register,
      refreshUser,
    }),
    [user, loading, initializing, login, logout, register, refreshUser],
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
