import axios from 'axios';

/**
 * Zeabur / PaaS friendly API base strategy:
 * - All-in-one (Flask serves React): PROD uses same-origin /api
 * - Split FE/BE: set VITE_API_BASE_URL
 */
const defaultProdBase = '/api';
const defaultDevBase = 'http://localhost:5000/api';

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.PROD ? defaultProdBase : defaultDevBase),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
