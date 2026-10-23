import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  // GitHub Pages serves the project site from /<repo>/ (and `vite preview` mirrors it); the dev server stays at the root.
  base: command === 'build' || isPreview ? '/DeChorder/' : '/',
  server: { port: 5173 },
}));
