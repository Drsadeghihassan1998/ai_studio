import { describe, expect, it } from 'vitest';
import {
  advantage, breakEvenRate, cashDelta, decide, endsAfter, expiryCheck, liquidity, monthsToSell, normalPayments, offerCashSeries,
  optimize, paymentOptions, present, qtyCap, revenueFlows, sensitivity, totalUnits, unitRevenue, verdictText,
  type CashContext, type OfferInput,
} from '../src/lib/offer';

const example = (over: Partial<OfferInput> = {}): OfferInput => ({
  price: 82000, consumerPrice: 100000, qty: 100, everyX: 10, freeY: 2, baseMonths: 6, discountPerMonth: 0.02,
  stock: 0, monthsToExpiry: 18, safetyMonths: 2, monthlyUse: 20, r: 0.03,
  mix: [{ key: 1, name: 'بیمه', share: 1, rate: 0.7, delay: 9, deduction: 0.03 }],
  normalPrice: 82000, normalMonths: 6, normalQty: 20,
  ...over,
});

const noCash: CashContext = { ends: [], offset: 0, minSafe: 0, active: false };

describe('مثال دستور مرحلهٔ ۶', () => {
  const i = example();
  it('تعداد، ماه‌های فروش و درآمد هر واحد', () => {
    expect(totalUnits(i, 100)).toBe(120);
    expect(monthsToSell(i, 100)).toBe(6);
    const u = unitRevenue(i);
    expect(u.cash).toBeCloseTo(30000);
    expect(u.later).toEqual([{ delay: 9, amount: expect.closeTo(67900) }]);
  });
  it('مبنا: ۱٬۶۴۰٬۰۰۰ در ماه‌های ۶ تا ۱۱', () => {
    const flows = normalPayments(i, 120);
    expect(flows.map((f) => f.month)).toEqual([6, 7, 8, 9, 10, 11]);
    flows.forEach((f) => expect(f.amount).toBe(1640000));
    expect(present(flows, 0.03)).toBeCloseTo(7663583.76, 1);
  });
  it('جدول گزینه‌های پرداخت برگهٔ تست', () => {
    const o = paymentOptions(i, 100);
    const want = [447583.76, 498535.22, 552640.22, 609671.85, 669413.72, 731659.57, 796212.85];
    expect(o).toHaveLength(7);
    o.forEach((row, n) => expect(row.advantage).toBeCloseTo(want[n], 1));
    expect(o[0].discount).toBeCloseTo(0.12);
    expect(o[0].paid).toBeCloseTo(7216000);
    expect(o[0].unitCost).toBeCloseTo(60133.33, 1);
    expect(o[6].paid).toBeCloseTo(8200000);
  });
  it('حساسیت و نرخ سربه‌سر', () => {
    const want = [2624000, 1104357.2, 447583.76, -149806.82, -693822.42, -1189802.3];
    sensitivity(i, 100, 0).forEach((row, n) => expect(row.advantage).toBeCloseTo(want[n], 0));
    expect(paymentOptions(i, 100)[0].breakEven).toBeCloseTo(0.0374026, 4);
    expect(paymentOptions(i, 100)[6].breakEven).toBeCloseTo(0.0793, 3);
  });
  it('حکم', () => {
    const v = decide(i, noCash);
    expect(v.kind).toBe('buy');
    expect(v.month).toBe(6);
    expect(verdictText(i, v)).toBe('بخرید، با چک ۶ ماهه و گرفتن بونوس');
  });
});

describe('چک‌لیست برگهٔ تست', () => {
  it('هزینهٔ پول ۱٪: بهترین گزینه نقد', () => {
    const i = example({ r: 0.01 });
    const v = decide(i, noCash);
    expect(v.month).toBe(0);
    expect(verdictText(i, v)).toBe('بخرید، با پرداخت نقد و گرفتن بونوس');
  });
  it('انقضا ۵ ماه: هشدار و ۵۰ عدد (با بونوس ۶۰)', () => {
    const i = example({ monthsToExpiry: 5 });
    const check = expiryCheck(i, 100);
    expect(check.risky).toBe(true);
    expect(check.unsold).toBe(20);
    expect(qtyCap(i)).toBe(50);
    const v = decide(i, noCash);
    expect(v.kind).toBe('limit');
    expect(v.qty).toBe(50);
    expect(totalUnits(i, v.qty)).toBe(60);
    expect(verdictText(i, v)).toContain('بخرید ولی فقط ۵۰ عدد');
  });
});

describe('نقدینگی', () => {
  const i = example();
  it('جریان این آفر به جای خرید عادی', () => {
    const delta = cashDelta(i, 100, 6);
    const ends = endsAfter(new Array(13).fill(1000000000), 0, delta);
    expect(ends[5]).toBe(1000000000);
    expect(ends[6]).toBeCloseTo(1000000000 - 8200000 + 1640000);
    expect(ends[11]).toBeCloseTo(1000000000 - 8200000 + 9840000);
  });
  it('چکی که نقدینگی را زیر حداقل می‌برد انتخاب نمی‌شود', () => {
    const cash: CashContext = { ends: new Array(24).fill(5000000), offset: 0, minSafe: 0, active: true };
    expect(liquidity(i, 100, 6, cash).ok).toBe(false);
    const v = decide(i, cash);
    expect(v.kind).toBe('limit');
    expect(v.qty).toBeLessThan(100);
    expect(liquidity(i, v.qty, v.month, cash).ok).toBe(true);
  });
  it('اگر از قبل زیر حداقل باشیم، فقط بدتر نشدن شرط است', () => {
    const cash: CashContext = { ends: [-10, -10, -10], offset: 0, minSafe: 0, active: true };
    expect(liquidity(i, 100, 6, cash).ok).toBe(true);
  });
});

describe('بقیهٔ محاسبات', () => {
  it('موجودی فعلی اول فروش می‌رود', () => {
    const i = example({ stock: 40 });
    expect(monthsToSell(i, 100)).toBe(8);
    expect(normalPayments(i, 120).map((f) => f.month)).toEqual([8, 9, 10, 11, 12, 13]);
    expect(revenueFlows(i, 20)[0].month).toBe(3);
  });
  it('واحد فروش‌نرفته هزینه دارد، پس مزیت کمتر است', () => {
    expect(advantage(example({ monthsToExpiry: 5 }), 100, 6, 0.03)).toBeLessThan(advantage(example(), 100, 6, 0.03));
  });
  it('خرید زیان‌ده حتی اگر از خرید عادی بهتر باشد: نخرید', () => {
    const i = example({ consumerPrice: 50000 });
    expect(advantage(i, 100, 6, 0.03)).toBeGreaterThan(0);
    expect(decide(i, noCash).kind).toBe('no');
  });
  it('بدون آفر و با قیمت گران‌تر: نخرید', () => {
    const i = example({ everyX: 0, freeY: 0, discountPerMonth: 0, price: 90000 });
    expect(decide(i, noCash).kind).toBe('no');
  });
  it('تعداد بهینه تا سقف انقضا', () => {
    // خرید خیلی زیاد پول را زود حبس می‌کند، پس بهترین تعداد لزوماً سقف نیست.
    const i = example();
    const best = optimize(i, noCash)!;
    expect(totalUnits(i, best.qty)).toBeLessThanOrEqual(320);
    for (let q = 10; q <= qtyCap(i); q += 10) {
      for (let m = 0; m <= 6; m++) expect(advantage(i, q, m, 0.03)).toBeLessThanOrEqual(best.advantage + 0.001);
    }
  });
  it('چند بیمه و آزاد', () => {
    const i = example({
      mix: [
        { key: 1, name: 'الف', share: 0.5, rate: 0.7, delay: 9, deduction: 0.03 },
        { key: 0, name: 'آزاد', share: 0.5, rate: 0, delay: 0, deduction: 0 },
      ],
    });
    const u = unitRevenue(i);
    expect(u.cash).toBeCloseTo(65000);
    expect(u.later[0].amount).toBeCloseTo(33950);
  });
  it('دوبخشی', () => {
    expect(breakEvenRate((r) => 0.05 - r)).toBeCloseTo(0.05);
    expect(breakEvenRate((r) => 1 + r)).toBeNull();
  });
  it('نمودار: هر دو سناریو به یک درآمد می‌رسند', () => {
    const { offer, base } = offerCashSeries(example(), 100, 0);
    expect(offer).toHaveLength(base.length);
    expect(offer.at(-1)! - base.at(-1)!).toBeCloseTo(9840000 - 7216000);
  });
});
