import axios from "axios";

// ✅ 合一部署（同網域）：PROD 一律打 /api
const apiBase =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.PROD ? "/api" : "http://localhost:5000/api");

console.log("[apiBase]", apiBase);

const api = axios.create({ baseURL: apiBase });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers = config.headers ?? {};
    // axios v1 compatibility
    if (typeof config.headers.set === "function") {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;
