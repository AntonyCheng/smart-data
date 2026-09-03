import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backendTarget = process.env.ZHISHU_BACKEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
