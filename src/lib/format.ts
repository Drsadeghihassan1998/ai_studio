import { jalaliParts } from './jalali';

export type Unit = 'toman' | 'rial';

export const UNIT_LABEL: Record<Unit, string> = { toman: 'تومان', rial: 'ریال' };

/** مبلغ‌ها همیشه به ریال ذخیره می‌شوند؛ تومان فقط برای نمایش است. */
export const fromRial = (rial: number, unit: Unit) => (unit === 'toman' ? rial / 10 : rial);
export const toRial = (value: number, unit: Unit) => Math.round(unit === 'toman' ? value * 10 : value);

export function faNumber(n: number, maxDigits = 0): string {
  return n.toLocaleString('fa-IR', { maximumFractionDigits: maxDigits });
}

/** کسر ← درصد: 0.03 ← «۳٪» */
export function faPercent(fraction: number, maxDigits = 2): string {
  return `${faNumber(fraction * 100, maxDigits)}٪`;
}

/** عدد خلاصه برای نمایش: «۴۲۰» + «میلیون» */
export function compactParts(abs: number): { value: string; scale: string } {
  const steps: [number, string][] = [
    [1e12, 'هزار میلیارد'],
    [1e9, 'میلیارد'],
    [1e6, 'میلیون'],
    [1e3, 'هزار'],
  ];
  for (const [size, scale] of steps) {
    if (abs >= size) {
      const v = abs / size;
      return { value: faNumber(v, v >= 100 ? 0 : 1), scale };
    }
  }
  return { value: faNumber(abs), scale: '' };
}

/** مبلغ کامل با جداکننده: «۴۲۰٬۰۰۰٬۰۰۰ تومان» */
export function fullMoney(rial: number, unit: Unit): string {
  // «+ 0» منفی صفر را به صفر تبدیل می‌کند تا «−۰» نوشته نشود.
  return `${faNumber(fromRial(rial, unit) + 0, 1)} ${UNIT_LABEL[unit]}`;
}

/** تاریخ شمسی: «۱۴۰۵/۰۸/۱۵» */
export function faDate(iso: string): string {
  const { y, m, d } = jalaliParts(iso);
  const p = (n: number, w: number) =>
    n.toLocaleString('fa-IR', { useGrouping: false, minimumIntegerDigits: w });
  return `${p(y, 4)}/${p(m, 2)}/${p(d, 2)}`;
}
