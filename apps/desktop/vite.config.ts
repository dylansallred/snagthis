import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      ...(command === 'build' ? [{ find: '@/dev/gallery', replacement: path.resolve(__dirname, './src/dev/gallery.production.ts') }] : []),
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
