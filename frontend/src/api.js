import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const api = axios.create({
  baseURL,
})

// 關鍵優化：攔截器 (Interceptors)
// 每次發送請求前，自動檢查 localStorage 有沒有 Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`; // 配合 Flask-JWT-Extended
  }
  return config;
});

export default api