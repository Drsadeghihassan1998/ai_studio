import { describe, expect, it } from 'vitest';
import { matches, normalizeText, parseNumber, parsePercent, toLatinDigits } from '../src/lib/text';
import { compactParts, faDate, fromRial, toRial } from '../src/lib/format';
import { monthLabel, parseMonth, isoFromJalali } from '../src/lib/jalali';

describe('نرمال‌سازی', () => {
  it('ی، ک، نیم‌فاصله، فاصله و ارقام', () => {
    expect(normalizeText('  علي   كريمي ')).toBe('علی کریمی');
    expect(normalizeText('می‌شود')).toBe('میشود');
    expect(toLatinDigits('۱۲٣٤')).toBe('1234');
    expect(matches('تأمين اجتماعي', 'اجتماعی')).toBe(true);
  });
  it('عدد', () => {
    expect(parseNumber('۱٬۲۵۰٬۰۰۰')).toBe(1250000);
    expect(parseNumber('1,250,000')).toBe(1250000);
    expect(parseNumber('۱۲٫۵')).toBe(12.5);
    expect(parseNumber('120-')).toBe(-120);
    expect(parseNumber('(120)')).toBe(-120);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('درصد', () => {
    expect(parsePercent('70%')).toBeCloseTo(0.7);
    expect(parsePercent('۷۰٪')).toBeCloseTo(0.7);
    expect(parsePercent(70)).toBeCloseTo(0.7);
    expect(parsePercent(0.7)).toBeCloseTo(0.7);
    expect(parsePercent('0.5%')).toBeCloseTo(0.005);
    expect(parsePercent('x')).toBeNull();
    expect(parsePercent('100\n70')).toBeNull();
    expect(parseNumber('8,610,000\n12,300,000')).toBeNull();
  });
});

describe('نمایش', () => {
  it('ریال و تومان', () => {
    expect(fromRial(4200, 'toman')).toBe(420);
    expect(toRial(420, 'toman')).toBe(4200);
    expect(toRial(420, 'rial')).toBe(420);
  });
  it('خلاصهٔ مبلغ', () => {
    expect(compactParts(420_000_000)).toEqual({ value: '۴۲۰', scale: 'میلیون' });
    expect(compactParts(1_500_000_000).scale).toBe('میلیارد');
    expect(compactParts(500).scale).toBe('');
  });
  it('تاریخ شمسی', () => {
    expect(faDate('2026-11-06')).toBe('۱۴۰۵/۰۸/۱۵');
    expect(isoFromJalali(1405, 8, 15)).toBe('2026-11-06');
    expect(monthLabel('1405-08')).toBe('آبان ۱۴۰۵');
    expect(parseMonth('۱۴۰۵/۸')).toBe('1405-08');
    expect(parseMonth('1405/13')).toBeNull();
  });
});
