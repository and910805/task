import axios from "axios";

const envBase = (import.meta.env.VITE_API_BASE_URL || "").trim();

// ✅ 防呆：如果 envBase 是 '' 或 '/'，視同沒設，改用預設 /api
const apiBase =
  envBase && envBase !== "/"
    ? envBase
    : (import.meta.env.PROD ? "/api" : "http://localhost:5000/api");

console.log("[apiBase]", apiBase);

const api = axios.create({ baseURL: apiBase });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers = config.headers ?? {};
    if (typeof config.headers.set === "function") {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;
