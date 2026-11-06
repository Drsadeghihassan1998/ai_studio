import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';

type Show = (message: string, kind?: 'ok' | 'error') => void;

const ToastContext = createContext<Show>(() => undefined);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'error'; key: number } | null>(null);
  const timer = useRef(0);

  const show = useCallback<Show>((message, kind = 'ok') => {
    window.clearTimeout(timer.current);
    setToast({ message, kind, key: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), kind === 'ok' ? 2500 : 5000);
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex justify-center md:bottom-8">
        {toast && (
          <div
            key={toast.key}
            className="toast flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2 shadow-card"
          >
            {toast.kind === 'ok' ? (
              <CircleCheck size={18} className="text-good" aria-hidden />
            ) : (
              <CircleAlert size={18} className="text-bad" aria-hidden />
            )}
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext>
  );
}
