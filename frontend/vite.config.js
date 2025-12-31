import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const spaFallbackPlugin = () => {
  const shouldServeIndexHtml = (req) => {
    if (req.method && req.method.toUpperCase() !== 'GET') {
      return false;
    }

    const acceptHeader = req.headers?.accept ?? '';
    if (!acceptHeader.includes('text/html') && !acceptHeader.includes('application/xhtml+xml')) {
      return false;
    }

    const url = req.url ?? '';

    // Skip API requests or assets
    if (url.startsWith('/api') || /\.[^/?#]+$/.test(url.split('?')[0])) {
      return false;
    }

    return true;
  };

  const middleware = (req, _res, next) => {
    if (shouldServeIndexHtml(req)) {
      req.url = '/index.html';
    }
    next();
  };

  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), spaFallbackPlugin()],
  build: {
    // 關鍵修正：將輸出目錄改回當前路徑下的 dist
    // 這樣 Zeabur 才能在正確的位置找到編譯好的檔案
    outDir: 'dist', 
    emptyOutDir: true,
  },
});
