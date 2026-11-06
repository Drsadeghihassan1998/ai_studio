import { describe, expect, it } from 'vitest';
import {
  capitalNeeded, chequeTermNeeded, DEFAULT_POLICY, firstBelow, firstWarning, invoiceMargin, lowestMonth, runCash, shiftMonth,
  type CashInputs,
} from '../src/lib/cashflow';
import type { InvoiceItem } from '../src/lib/db';

const S = 500_000_000;

/** پارامترهای برگهٔ تست مرحلهٔ ۵ */
const sheet = (over: Partial<CashInputs> = {}, delay = 9): CashInputs => ({
  startMonth: '1405-08',
  openingCash: 1_000_000_000,
  minSafe: 0,
  policy: { ...DEFAULT_POLICY, cashShare: 0, chequeMonths: 3, stockDays: 0, marginFromInvoices: false, margin: 0.18 },
  margin: 0.18,
  technicalFee: 0,
  technicalFeeInsurerShare: 0,
  streams: [{
    key: 1, name: 'آزمایشی', startMonth: '1405-08', rx: 1000, rent: 0, allowance: 0,
    byInsurer: [
      { key: 1, name: 'بیمه', share: 0.8, sales: S * 0.8, insurer: S * 0.8 * 0.7 },
      { key: 0, name: 'آزاد', share: 0.2, sales: S * 0.2, insurer: 0 },
    ],
  }],
  insurers: [{ key: 1, name: 'بیمه', delay, deduction: 0.03 }],
  fixed: [{ title: 'ثابت', monthly: 60_000_000, startMonth: '1405-08' }],
  oneOff: [],
  cheques: [],
  purchases: [],
  ...over,
});

/** فرمول خود برگهٔ اکسل */
function expected(delay: number, months = 24) {
  const out: number[] = [];
  let cash = 1_000_000_000;
  for (let t = 1; t <= months; t++) {
    const inflow = S * (1 - 0.56) + (t > delay ? S * 0.56 * 0.97 : 0);
    const outflow = 60_000_000 + (t > 3 ? S * 0.82 : 0);
    cash += inflow - outflow;
    out.push(cash);
  }
  return out;
}

describe('برگهٔ تست مرحلهٔ ۵', () => {
  it('هر ۲۴ ماه با جواب برگه یکی است', () => {
    const months = runCash(sheet());
    const want = expected(9);
    months.forEach((m, i) => expect(m.end).toBeCloseTo(want[i], 2));
    expect(months[0].end).toBeCloseTo(1_160_000_000);
    expect(months[3].end).toBeCloseTo(1_230_000_000);
    expect(months[8].end).toBeCloseTo(-20_000_000);
    expect(months[9].end).toBeCloseTo(1_600_000);
    expect(months[23].end).toBeCloseTo(304_000_000);
  });
  it('آزمون اضافه: تأخیر ۱۲ ماه', () => {
    const months = runCash(sheet({}, 12));
    const want = expected(12);
    months.forEach((m, i) => expect(m.end).toBeCloseTo(want[i], 2));
  });
  it('ماه ۹ کسری با علت تأخیر بیمه', () => {
    const input = sheet();
    const w = firstWarning(runCash(input), input)!;
    expect(w.month.index).toBe(9);
    expect(w.gap).toBeCloseTo(20_000_000);
    expect(w.level).toBe('short');
    expect(w.cause).toBe('insurer');
  });
});

describe('تست فشار', () => {
  it('تأخیر بیشتر همان نتیجهٔ تأخیر بالاتر را می‌دهد', () => {
    const stressed = runCash(sheet(), { extraDelay: 3, salesDrop: 0 });
    const direct = runCash(sheet({}, 12));
    expect(stressed[23].end).toBeCloseTo(direct[23].end);
  });
  it('فروش کمتر، خرید و سهم بیمه را هم کم می‌کند', () => {
    const [m] = runCash(sheet(), { extraDelay: 0, salesDrop: 0.2 });
    expect(m.sales).toBeCloseTo(S * 0.8);
    expect(m.cogs).toBeCloseTo(S * 0.8 * 0.82);
  });
});

describe('پیشنهاد', () => {
  it('سرمایهٔ لازم و مدت چک', () => {
    const input = sheet();
    const months = runCash(input);
    expect(capitalNeeded(months, 0)).toBeCloseTo(20_000_000);
    const funded = runCash({ ...input, openingCash: input.openingCash + 20_000_000 });
    expect(lowestMonth(funded).end).toBeCloseTo(0);
    const term = chequeTermNeeded(input)!;
    expect(term).toBeGreaterThan(3);
    const ok = runCash({ ...input, policy: { ...input.policy, chequeMonths: term } });
    expect(firstBelow(ok, 0)).toBeUndefined();
    const short = runCash({ ...input, policy: { ...input.policy, chequeMonths: term - 1 } });
    expect(firstBelow(short, 0)).toBeDefined();
  });
});

describe('اجزای ماه', () => {
  it('خرید نقدی و چکی', () => {
    const input = sheet();
    input.policy = { ...input.policy, cashShare: 0.25, chequeMonths: 2 };
    const months = runCash(input);
    expect(months[0].cashPurchase).toBeCloseTo(S * 0.82 * 0.25);
    expect(months[0].forecastCheque).toBe(0);
    expect(months[2].forecastCheque).toBeCloseTo(S * 0.82 * 0.75);
  });
  it('موجودی ۳۰ روزه فقط ماه اول خرید را بیشتر می‌کند', () => {
    const input = sheet();
    input.policy = { ...input.policy, stockDays: 30 };
    const months = runCash(input);
    expect(months[0].purchase).toBeCloseTo(S * 0.82 * 2);
    expect(months[1].purchase).toBeCloseTo(S * 0.82);
  });
  it('خرید ثبت‌شده دوبار حساب نمی‌شود؛ چک و نقد ثبت‌شده خروجی است', () => {
    const input = sheet({
      purchases: [{ month: '1405-08', total: 100_000_000, cash: 40_000_000 }],
      cheques: [{ month: '1405-09', amount: 60_000_000 }],
    });
    const months = runCash(input);
    expect(months[0].purchase).toBeCloseTo(S * 0.82 - 100_000_000);
    expect(months[0].registeredCash).toBe(40_000_000);
    expect(months[1].registeredCheque).toBe(60_000_000);
  });
  it('حق فنی: سهم بیمار الان، سهم بیمه با تأخیر', () => {
    const input = sheet({ technicalFee: 1000, technicalFeeInsurerShare: 0.5 });
    const [m] = runCash(input);
    expect(m.feeTotal).toBeCloseTo(1_000_000);
    expect(m.feeInsurer).toBeCloseTo(400_000);
    expect(m.feePatient).toBeCloseTo(600_000);
    expect(m.claims.get(1)).toBeCloseTo(S * 0.56 + 400_000);
  });
  it('پزشکی که بعداً شروع می‌کند', () => {
    const input = sheet();
    input.streams[0].startMonth = '1405-10';
    const months = runCash(input);
    expect(months[0].sales).toBe(0);
    expect(months[2].sales).toBeCloseTo(S);
  });
  it('هزینهٔ ثابت با بازه و هزینهٔ یک‌باره', () => {
    const input = sheet({
      fixed: [{ title: 'الف', monthly: 10, startMonth: '1405-09', endMonth: '1405-10' }],
      oneOff: [{ title: 'ب', amount: 7, month: '1405-08' }],
    });
    const months = runCash(input);
    expect(months.slice(0, 4).map((m) => m.fixed)).toEqual([0, 10, 10, 0]);
    expect(months[0].oneOff).toBe(7);
  });
  it('افق قابل تغییر و گذر از سال', () => {
    const input = sheet();
    input.policy = { ...input.policy, horizon: 12 };
    expect(runCash(input)).toHaveLength(12);
    expect(shiftMonth('1405-11', 3)).toBe('1406-02');
    expect(shiftMonth('1405-12', 1)).toBe('1406-01');
  });
});

describe('سود و زیان و طلب', () => {
  it('سود تعهدی مثبت با پول کم', () => {
    const months = runCash(sheet());
    const m = months[8];
    // فروش ۵۰۰ − بهای تمام‌شده ۴۱۰ − کسورات ۸٫۴ − ثابت ۶۰
    expect(m.netProfit).toBeCloseTo(21_600_000);
    expect(m.end).toBeLessThan(0);
    expect(m.byDoctor[0].net).toBeCloseTo(81_600_000);
    expect(m.byInsurer.find((r) => r.key === 1)?.deductions).toBeCloseTo(8_400_000);
  });
  it('طلب انباشته تا سقف تأخیر بالا می‌رود', () => {
    const months = runCash(sheet());
    expect(months[0].receivableTotal).toBeCloseTo(280_000_000);
    expect(months[8].receivableTotal).toBeCloseTo(280_000_000 * 9);
    expect(months[9].receivableTotal).toBeCloseTo(280_000_000 * 9);
    expect(months[9].collected).toBeCloseTo(271_600_000);
  });
  it('درصد سود از فاکتور با وزن فروش', () => {
    const item = (consumerPrice: number, quantity: number, total: number) =>
      ({ consumerPrice, quantity, bonus: 0, total }) as InvoiceItem;
    expect(invoiceMargin([item(100, 10, 800), item(100, 30, 2100)])).toBeCloseTo(0.275);
    expect(invoiceMargin([])).toBeNull();
  });
});
