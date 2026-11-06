import { jalaaliMonthLength, toGregorian, toJalaali } from 'jalaali-js';
import { parseNumber } from './text';

// تاریخ کامل در پایگاه داده به شکل میلادی «2026-11-06» و ماه به شکل شمسی «1405-08» ذخیره می‌شود.

export const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function jalaliParts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const j = toJalaali(y, m, d);
  return { y: j.jy, m: j.jm, d: j.jd };
}

export function isoFromJalali(y: number, m: number, d: number): string {
  const g = toGregorian(y, m, Math.min(d, jalaaliMonthLength(y, m)));
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

export function monthKey(y: number, m: number): string {
  return `${y}-${pad(m)}`;
}

export function currentMonthKey(now = new Date()): string {
  const { y, m } = jalaliParts(todayISO(now));
  return monthKey(y, m);
}

/** «1405-08» ← «آبان ۱۴۰۵» */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return '';
  return `${MONTH_NAMES[m - 1]} ${y.toLocaleString('fa-IR', { useGrouping: false })}`;
}

/** خواندن ماه از متن فایل: «1405/8» یا «۱۴۰۵-۰۸» ← «1405-08» */
export function parseMonth(input: unknown): string | null {
  const [y, m] = String(input ?? '').split(/[/\-.]/).map(parseNumber);
  if (!y || !m || y < 1300 || y > 1500 || m < 1 || m > 12) return null;
  return monthKey(y, m);
}

/** افزودن ماه شمسی به تاریخ؛ روز در ماه کوتاه‌تر به آخر ماه می‌افتد. */
export function addJalaliMonths(iso: string, months: number): string {
  const { y, m, d } = jalaliParts(iso);
  const index = y * 12 + (m - 1) + months;
  return isoFromJalali(Math.floor(index / 12), (index % 12) + 1, d);
}

/** خواندن تاریخ شمسی «1405/08/15» یا «۱۴۰۵/۸/۱۵»؛ تاریخ نامعتبر تهی برمی‌گرداند. */
export function parseJalaliDate(input: unknown): string | null {
  const parts = String(input ?? '').trim().split(/[/\-.]/).map(parseNumber);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d || y < 1300 || y > 1500 || m < 1 || m > 12 || d < 1 || d > jalaaliMonthLength(y, m)) return null;
  return isoFromJalali(y, m, d);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}
