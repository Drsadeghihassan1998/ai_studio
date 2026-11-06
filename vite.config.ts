import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// خروجی یک فایل index.html است که همه‌چیز (حتی فونت) داخل آن است
// و با دوبار کلیک، بدون سرور و بدون اینترنت باز می‌شود.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
  server: { port: 5183, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
