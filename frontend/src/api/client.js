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
  // If page is served over HTTPS but apiBase resolves to http,
  // upgrade protocol to https while keeping host + path.
  if (typeof window !== "undefined" && window.location?.protocol === "https:") {
    try {
      const url = new URL(apiBase, window.location.origin);
      if (url.protocol === "http:") {
        url.protocol = "https:";
        apiBase = url.toString();
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
  timeout: 15000,
  // withCredentials: true, // 如果你用 cookie 才開
});

const RETRYABLE_METHODS = new Set(["get", "head", "options"]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_READ_RETRIES = 2;

const retryDelay = (retryCount, retryAfter) => {
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 5000);
  }
  return 700 * (2 ** (retryCount - 1));
};

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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const isTimeout =
      error?.code === "ECONNABORTED" ||
      (typeof error?.message === "string" && error.message.toLowerCase().includes("timeout"));
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    const isNetworkError = error?.code === "ERR_NETWORK" || !error?.response;
    const config = error?.config;
    const method = String(config?.method || "get").toLowerCase();
    const status = Number(error?.response?.status || 0);
    const retryCount = Number(config?._readRetryCount || 0);
    const shouldRetry =
      config &&
      !axios.isCancel(error) &&
      !isOffline &&
      RETRYABLE_METHODS.has(method) &&
      retryCount < MAX_READ_RETRIES &&
      (isTimeout || isNetworkError || RETRYABLE_STATUSES.has(status));

    if (shouldRetry) {
      config._readRetryCount = retryCount + 1;
      const delay = retryDelay(
        config._readRetryCount,
        error?.response?.headers?.["retry-after"],
      );
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      return api.request(config);
    }

    if (isTimeout) {
      error.networkMessage = "連線逾時，請按重新整理再試。";
    } else if (isOffline) {
      error.networkMessage = "目前離線，請確認網路連線。";
    } else if (isNetworkError) {
      error.networkMessage = "網路不穩或服務正在啟動，請按重新整理再試。";
    }

    return Promise.reject(error);
  },
);

export default api;
