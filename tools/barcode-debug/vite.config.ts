import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: false,
    build: { outDir: '../../reports/barcode-debug-build', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 4197, strictPort: true },
    preview: { host: '127.0.0.1', port: 4198, strictPort: true },
});
