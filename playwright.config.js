import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localBrowser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(path => existsSync(path));

export default defineConfig({
    testDir: './e2e', workers: 1, timeout: 45000,
    use: { baseURL: 'http://127.0.0.1:8083', headless: true, viewport: { width: 1440, height: 1000 },
        launchOptions: localBrowser ? { executablePath: localBrowser } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 8083 --strictPort', url: 'http://127.0.0.1:8083', reuseExistingServer: false,
        env: { GUIAS_E2E: '1', VITE_SUPABASE_URL: 'https://guias-tests.supabase.co', VITE_SUPABASE_ANON_KEY: 'clave-publica-de-prueba' } }
});
