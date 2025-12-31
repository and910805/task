import axios from 'axios';

const api = axios.create({
  // 如果是正式環境，直接寫死後端的 API 網址，最保險！
  baseURL: import.meta.env.PROD 
    ? 'https://api.kuanlin.pro/api' 
    : 'http://localhost:5000/api',
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