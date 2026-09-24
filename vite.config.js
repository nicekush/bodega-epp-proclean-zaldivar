import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8082,
    open: true
  },
  build: {
    outDir: 'dist'
  },
  envPrefix: ['VITE_', 'NEXT_PUBLIC_', 'SUPABASE_']
});
