import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: frontendDirectory,
  plugins: [react()],
  build: {
    outDir: path.resolve(frontendDirectory, '../dist'),
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001'
    }
  }
});
