import { describe, expect, it } from 'vitest';
import {
  bonusUnits, cashStatus, dueCheques, earlyPayDiscount, effectiveUnitCost, insurerShare,
  marginOnCost, marginOnSale, netPaid, patientShare, presentValue,
} from '../src/lib/calc';

describe('خرید از شرکت پخش', () => {
  it('آفر ۱۰+۲', () => {
    expect(bonusUnits(10, 10, 2)).toBe(2);
    expect(bonusUnits(25, 10, 2)).toBe(4);
    expect(bonusUnits(9, 10, 2)).toBe(0);
  });
  it('چک ۶ ماهه با ۲٪ در ماه: نقد ۱۲٪', () => {
    expect(earlyPayDiscount(0.02, 6, 0)).toBeCloseTo(0.12);
    expect(earlyPayDiscount(0.02, 6, 2)).toBeCloseTo(0.08);
    expect(earlyPayDiscount(0.02, 6, 6)).toBe(0);
    expect(earlyPayDiscount(0.02, 6, 8)).toBe(0);
  });
  it('تخفیف روی مبلغ، بونوس فقط روی تعداد', () => {
    const paid = netPaid(1000, 0.12, 0.1);
    expect(paid).toBeCloseTo(968);
    expect(effectiveUnitCost(paid, 10, 2)).toBeCloseTo(968 / 12);
    expect(effectiveUnitCost(100, 0, 0)).toBe(0);
  });
});

describe('سود', () => {
  it('دو درصد سود با هم فرق دارند', () => {
    expect(marginOnSale(100, 80)).toBeCloseTo(0.2);
    expect(marginOnCost(100, 80)).toBeCloseTo(0.25);
  });
});

describe('سهم بیمه', () => {
  it('مبلغ مستقیم بر درصد مقدم است', () => {
    expect(insurerShare({ direct: 500, rate: 0.7, base: 1000 })).toBe(500);
    expect(insurerShare({ direct: 0, rate: 0.7, base: 1000 })).toBe(0);
    expect(insurerShare({ rate: 0.7, base: 1000 })).toBeCloseTo(700);
  });
  it('مابه‌التفاوت سقف را بیمار می‌دهد', () => {
    expect(patientShare(1200, 700)).toBe(500);
  });
});

describe('پول و چک', () => {
  it('تنزیل', () => {
    expect(presentValue(103, 0.03, 1)).toBeCloseTo(100);
    expect(presentValue(100, 0.03, 0)).toBe(100);
  });
  it('چک‌های سررسید', () => {
    const list = [
      { amount: 10, dueDate: '2026-11-20', status: 'pending' },
      { amount: 20, dueDate: '2026-11-01', status: 'pending' },
      { amount: 40, dueDate: '2026-11-02', status: 'paid' },
      { amount: 80, dueDate: '2027-01-01', status: 'pending' },
    ];
    const r = dueCheques(list, '2026-12-06');
    expect(r.total).toBe(30);
    expect(r.items[0].amount).toBe(20);
  });
  it('وضعیت موجودی', () => {
    expect(cashStatus(-1, 0)).toBe('short');
    expect(cashStatus(5, 10)).toBe('warn');
    expect(cashStatus(10, 10)).toBe('safe');
  });
});
