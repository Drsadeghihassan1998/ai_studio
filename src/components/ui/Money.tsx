import { useState } from 'react';
import { compactParts, fromRial, fullMoney, UNIT_LABEL } from '../../lib/format';
import { useUnit } from '../SettingsContext';

/** مبلغ خلاصه. عدد کامل با نگه‌داشتن ماوس یا لمس دیده می‌شود. منفی‌ها قرمزند. */
export function Money({
  rial,
  big = false,
  exact = false,
  inButton = false,
}: {
  rial: number;
  big?: boolean;
  exact?: boolean;
  /** داخل یک دکمهٔ دیگر: عدد خلاصه بدون دکمهٔ خودش؛ عدد کامل با نگه‌داشتن ماوس */
  inButton?: boolean;
}) {
  const unit = useUnit();
  const [open, setOpen] = useState(false);
  const negative = rial < 0;
  if (exact) return <span className={negative ? 'text-bad' : ''}>{fullMoney(rial, unit)}</span>;
  const { value, scale } = compactParts(Math.abs(fromRial(rial, unit)));
  const full = fullMoney(rial, unit);
  if (inButton) {
    return (
      <span title={full} className={negative ? 'text-bad' : ''}>
        <span dir="ltr" className="inline-block">
          {negative ? '−' : ''}
          {value}
        </span>{' '}
        {scale} {UNIT_LABEL[unit]}
      </span>
    );
  }
  return (
    <span className="group relative inline-block">
      <button
        type="button"
        aria-label={full}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        className={`text-start ${negative ? 'text-bad' : ''}`}
      >
        <span dir="ltr" className="inline-block">
          {negative ? '−' : ''}
          {value}
        </span>{' '}
        <span className={big ? 'text-body font-medium' : ''}>
          {scale} {UNIT_LABEL[unit]}
        </span>
      </button>
      <span
        role="tooltip"
        className={`absolute start-0 bottom-full z-20 mb-1 rounded-lg border border-line bg-card px-2 py-1 text-note font-normal whitespace-nowrap text-ink shadow-card group-hover:block ${
          open ? 'block' : 'hidden'
        }`}
      >
        {full}
      </span>
    </span>
  );
}
