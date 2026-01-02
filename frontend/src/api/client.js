import axios from "axios";

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
const envBase = (import.meta.env.VITE_API_BASE_URL || "").trim();

// ✅ 防呆：如果 envBase 是 '' 或 '/'，視同沒設，改用預設 /api
const apiBase =
  envBase && envBase !== "/"
    ? envBase
    : (import.meta.env.PROD ? "/api" : "http://localhost:5000/api");
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
// ✅ 合一部署（同網域）：PROD 一律打 /api
const rawApiBase = import.meta.env.VITE_API_BASE_URL;
const normalizedApiBase = rawApiBase?.trim();
const hasCustomApiBase =
  normalizedApiBase && normalizedApiBase !== "" && normalizedApiBase !== "/";
let apiBase = hasCustomApiBase
  ? normalizedApiBase
  : import.meta.env.PROD
    ? "/api"
    : "http://localhost:5000/api";

// Avoid mixed-content when the page is served over HTTPS but VITE_API_BASE_URL
// accidentally points to http://<same-host>/api. In that case, upgrade to the
// current origin while preserving the path.
if (typeof window !== "undefined" && window.location?.protocol === "https:") {
  try {
    const url = new URL(apiBase, window.location.origin);
    const isHttpSameHost =
      url.protocol === "http:" && url.hostname === window.location.hostname;

    if (isHttpSameHost) {
      apiBase = `${window.location.origin}${url.pathname}${url.search}`;
    }
  } catch (error) {
    // If parsing fails, keep the original apiBase.
  }
}
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs

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
