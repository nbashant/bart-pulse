import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const publicBartKey = 'MW9S-E7SL-26DU-VV8V';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env.BART_API_KEY || publicBartKey;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/bart/etd': {
          target: 'https://api.bart.gov',
          changeOrigin: true,
          rewrite: () => `/api/etd.aspx?cmd=etd&orig=ALL&key=${encodeURIComponent(key)}&json=y&gbColor=1`,
        },
        '/api/bart/advisories': {
          target: 'https://api.bart.gov',
          changeOrigin: true,
          rewrite: () => `/api/bsa.aspx?cmd=bsa&key=${encodeURIComponent(key)}&json=y`,
        },
      },
    },
  };
});
