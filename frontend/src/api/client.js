// frontend/src/api/client.js
import axios from "axios";

/**
 * Normalize base URL from env.
 * - If VITE_API_BASE_URL is empty or '/', treat as unset.
 * - In production (same domain), default to '/api'.
 * - In dev, default to 'http://localhost:5000/api'.
 */
function getApiBase() {
  const rawApiBase = import.meta.env.VITE_API_BASE_URL;
  const normalized = (rawApiBase ?? "").trim();

  const hasCustom =
    normalized !== "" && normalized !== "/";

  let apiBase = hasCustom
    ? normalized
    : import.meta.env.PROD
      ? "/api"
      : "http://localhost:5000/api";

  // Avoid mixed-content:
  // If page is served over HTTPS but apiBase resolves to http://same-host/api,
  // upgrade to https current origin while keeping path.
  if (typeof window !== "undefined" && window.location?.protocol === "https:") {
    try {
      const url = new URL(apiBase, window.location.origin);
      const isHttpSameHost =
        url.protocol === "http:" && url.hostname === window.location.hostname;

      if (isHttpSameHost) {
        apiBase = `${window.location.origin}${url.pathname}${url.search}`;
      }
    } catch {
      // keep original apiBase if parsing fails
    }
  }

  return apiBase;
}

const apiBase = getApiBase();
console.log("[apiBase]", apiBase);

const api = axios.create({
  baseURL: apiBase,
  // withCredentials: true, // 如果你用 cookie 才開
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers = config.headers ?? {};
    // axios v1 headers may be AxiosHeaders with .set()
    if (typeof config.headers.set === "function") {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;
