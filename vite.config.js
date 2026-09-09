import { defineConfig } from 'vite';

// Pinned so the README's URL is deterministic.
export default defineConfig({
  server: { port: 5173, strictPort: true },
});
