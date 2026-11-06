import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { ensureDefaults } from './lib/db';

const root = createRoot(document.getElementById('root')!);

// از مرورگر می‌خواهد داده‌ها را هنگام کمبود فضا پاک نکند.
navigator.storage?.persist?.().catch(() => undefined);

ensureDefaults()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch(() => {
    root.render(
      <p className="mx-auto max-w-md p-8 text-center">
        مرورگر اجازهٔ ذخیرهٔ داده را نمی‌دهد. برنامه را در پنجرهٔ معمولی Chrome یا Edge باز کنید، نه در حالت ناشناس.
      </p>,
    );
  });
