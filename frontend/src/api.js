import axios from "axios";

const envUrl = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const baseURL = envUrl || "/api";

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
