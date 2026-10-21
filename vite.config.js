import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8082,
    open: process.env.GUIAS_E2E !== '1'
  },
  build: {
    outDir: 'dist'
  },
  envPrefix: ['VITE_', 'NEXT_PUBLIC_', 'SUPABASE_']
});
