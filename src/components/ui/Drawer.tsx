import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** پنل کشویی: در دسکتاپ از کنار و در موبایل از پایین باز می‌شود. */
export function Drawer({
  open,
  onClose,
  title,
  wide = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`drawer ${wide ? 'wide' : ''}`}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="flex h-full max-h-[88dvh] flex-col md:max-h-none">
          <div className="flex items-center justify-between gap-4 border-b border-line py-2 ps-6 pe-2">
            <h2 className="text-cardtitle font-medium">{title}</h2>
            <button
              type="button"
              aria-label="بستن"
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-xl text-muted"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
          {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
