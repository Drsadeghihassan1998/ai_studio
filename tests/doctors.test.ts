import { describe, expect, it } from 'vitest';
import { forecastError, monthlyRx, movingAverage3 } from '../src/lib/calc';
import { DEFAULT_POLICY, runCash, streamOf } from '../src/lib/cashflow';
import { completeDrug, type Coverage, type Doctor, type Drug, type Insurer, type Sale, type Settings } from '../src/lib/db';
import { buildContext, drugConsumption, forecastDoctor, mixProblem, newDoctor, totalsOf, workDaysFromWeek } from '../src/lib/doctors';

const insurer = (id: number, defaultShare: number, extra: Partial<Insurer> = {}): Insurer => ({
  id, name: `بیمه ${id}`, delayMonths: 6, deductionRate: 0, priceListId: null, defaultShare, active: true, ...extra,
});

const drug = (id: number, price: number): Drug => ({ ...completeDrug({ genericName: `D${id}`, price, otc: false }), id } as Drug);

const ctx = (over: { drugs?: Drug[]; coverage?: Coverage[]; sales?: Sale[]; margin?: number } = {}) =>
  buildContext({
    drugs: over.drugs ?? [drug(1, 1000)],
    coverage: over.coverage ?? [],
    insurers: [insurer(1, 0.7)],
    lists: [],
    items: [],
    invoices: [],
    distributors: [],
    sales: over.sales ?? [],
    settings: { defaultMarginRate: over.margin ?? 0.18 } as Settings,
  });

const base = (over: Partial<Doctor> = {}) => ({
  ...newDoctor('1405-08'), name: 'تست', rxPerDay: 50, workDays: 25, captureRate: 0.7, avgRxAmount: 500000,
  insurerMix: { 1: 0.8, 0: 0.2 }, officeRent: 40000000, pharmacyRentShare: 0.5, monthlyAllowance: 15000000, ...over,
});

describe('برگهٔ تست مرحلهٔ ۴', () => {
  it('پنج آزمون روی یک پزشک، حتی با یک داروی پروفایل', () => {
    const f = forecastDoctor(base(), [{ drugId: 1, rxShare: 0.2, qtyPerRx: 1 }], ctx());
    expect(f.rx).toBeCloseTo(875);
    expect(f.rows[0].use).toBeCloseTo(175);
    expect(f.sales).toBeCloseTo(437500000);
    expect(f.insurer).toBeCloseTo(245000000);
    expect(f.net).toBeCloseTo(43750000);
    expect(f.source).toBe('manual');
    expect(f.basis).toBe('average');
  });
  it('جمع ۱۰۵٪ خطا می‌دهد', () => {
    expect(mixProblem({ 1: 0.6, 2: 0.3, 0: 0.15 })).toContain('۱۰۵');
    expect(mixProblem({ 1: 0.8, 0: 0.2 })).toBeNull();
    expect(mixProblem({ 1: 0.1 + 0.2, 0: 0.7 })).toBeNull();
  });
  it('میانگین متحرک و خطا (برگهٔ مرحلهٔ ۷)', () => {
    expect(movingAverage3([800, 900, 1000])).toBeCloseTo(900);
    expect(movingAverage3([1, 800, 900, 1000])).toBeCloseTo(900);
    expect(forecastError(875, 900)).toBeCloseTo(0.027778);
    expect(monthlyRx(35, 17, 0.7)).toBeCloseTo(416.5);
  });
});

describe('روش فروش', () => {
  it('بدون میانگین مبلغ، از پروفایل و قیمت و سهم بانک دارو', () => {
    const f = forecastDoctor(base({ avgRxAmount: 0 }), [{ drugId: 1, rxShare: 0.2, qtyPerRx: 2 }], ctx());
    expect(f.basis).toBe('profile');
    // ۳۵۰ عدد در ماه؛ ۸۰٪ بیمه‌ای با سهم پیش‌فرض ۷۰٪
    expect(f.sales).toBeCloseTo(350000);
    expect(f.insurer).toBeCloseTo(350 * 0.8 * 700);
    expect(f.gross).toBeCloseTo(350000 * 0.18);
  });
  it('انتخاب دستی پروفایل', () => {
    const f = forecastDoctor(base({ salesBasis: 'profile' }), [{ drugId: 1, rxShare: 0.2, qtyPerRx: 1 }], ctx());
    expect(f.basis).toBe('profile');
    expect(f.averageSales).toBeCloseTo(437500000);
  });
  it('نه پروفایل نه میانگین', () => {
    expect(forecastDoctor(base({ avgRxAmount: 0 }), [], ctx()).basis).toBe('none');
  });
  it('سود قلم از آخرین خرید', () => {
    const c = ctx();
    c.margins.set(1, 0.4);
    const f = forecastDoctor(base({ avgRxAmount: 0 }), [{ drugId: 1, rxShare: 0.2, qtyPerRx: 1 }], c);
    expect(f.rows[0].marginFromPurchase).toBe(true);
    expect(f.gross).toBeCloseTo(f.sales * 0.4);
  });
});

describe('داده‌های واقعی', () => {
  const sale = (date: string, rxNumber: string, total: number, drugId = 1): Sale => ({
    id: 0, date, rxNumber, doctorId: 7, drugId, quantity: 2, total, insurerShare: total / 2, patientShare: total / 2,
  });
  it('میانگین متحرک جای تخمین را می‌گیرد و برچسب عوض می‌شود', () => {
    const sales = [sale('2026-08-01', 'a', 300), sale('2026-09-01', 'b', 600), sale('2026-09-02', 'c', 300), sale('2026-10-01', 'd', 900)];
    const c = ctx({ sales });
    const f = forecastDoctor({ ...base(), id: 7 }, [], c);
    expect(f.source).toBe('actual');
    expect(f.rx).toBeCloseTo(4 / 3);
    expect(f.sales).toBeCloseTo(700);
    expect(forecastDoctor({ ...base(), id: 8 }, [], c).source).toBe('manual');
    const use = drugConsumption([f], c);
    expect(use[0].source).toBe('actual');
  });

  it('پزشک بدون تخمین با دو فروش واقعی: جمع byInsurer با sales و insurer برابر است و در runCash فروش ۱۰۰ میلیون می‌دهد', () => {
    const twoMonthSales: Sale[] = [
      { id: 1, date: '2026-08-10', rxNumber: 'r1', doctorId: 7, drugId: 1, quantity: 10, total: 100_000_000, insurerShare: 80_000_000, patientShare: 20_000_000 },
      { id: 2, date: '2026-09-10', rxNumber: 'r2', doctorId: 7, drugId: 1, quantity: 10, total: 100_000_000, insurerShare: 80_000_000, patientShare: 20_000_000 },
    ];
    const c = ctx({ sales: twoMonthSales });

    // ۱. پزشک بدون تخمین (rxPerDay 0، avgRxAmount 0)
    const noEstDoc = base({ id: 7, rxPerDay: 0, avgRxAmount: 0, insurerMix: { 1: 1 } });
    const fNoEst = forecastDoctor(noEstDoc, [], c);
    expect(fNoEst.sales).toBeCloseTo(100_000_000);
    expect(fNoEst.insurer).toBeCloseTo(80_000_000);
    const sumSalesNoEst = fNoEst.byInsurer.reduce((s, r) => s + r.sales, 0);
    const sumInsurerNoEst = fNoEst.byInsurer.reduce((s, r) => s + r.insurer, 0);
    expect(sumSalesNoEst).toBeCloseTo(100_000_000);
    expect(sumInsurerNoEst).toBeCloseTo(80_000_000);
    expect(fNoEst.byInsurer[0].patient).toBeCloseTo(20_000_000);

    // ۲. همان پزشک با rxPerDay 10 و avgRxAmount 5,000,000
    const withEstDoc = base({ id: 7, rxPerDay: 10, avgRxAmount: 5_000_000, insurerMix: { 1: 1 } });
    const fWithEst = forecastDoctor(withEstDoc, [], c);
    const sumSalesWithEst = fWithEst.byInsurer.reduce((s, r) => s + r.sales, 0);
    const sumInsurerWithEst = fWithEst.byInsurer.reduce((s, r) => s + r.insurer, 0);
    expect(sumSalesWithEst).toBeCloseTo(100_000_000);
    expect(sumInsurerWithEst).toBeCloseTo(80_000_000);

    // ۳. تست نقدینگی: streamOf روی پزشک بدون تخمین در runCash فروش ماهانهٔ ۱۰۰ میلیون بدهد
    const cashMonths = runCash({
      startMonth: '1405-08',
      openingCash: 0,
      minSafe: 0,
      policy: DEFAULT_POLICY,
      margin: 0.18,
      technicalFee: 0,
      technicalFeeInsurerShare: 0,
      streams: [streamOf(fNoEst, 7)],
      insurers: [{ key: 1, name: 'بیمه 1', delay: 6, deduction: 0 }],
      fixed: [],
      oneOff: [],
      cheques: [],
      purchases: [],
    });
    expect(cashMonths[0].sales).toBeCloseTo(100_000_000);
    expect(cashMonths[0].insurerShare).toBeCloseTo(80_000_000);
    expect(cashMonths[0].patientShare).toBeCloseTo(20_000_000);
  });

  it('فروش واقعی دارای insurerId مستقیم بر اساس بیمهٔ هر فروش جمع زده می‌شود', () => {
    const directSales: Sale[] = [
      { id: 1, date: '2026-08-10', rxNumber: 'r1', doctorId: 7, insurerId: 1, drugId: 1, quantity: 5, total: 60_000_000, insurerShare: 50_000_000, patientShare: 10_000_000 },
      { id: 2, date: '2026-08-12', rxNumber: 'r2', doctorId: 7, insurerId: 0, drugId: 1, quantity: 5, total: 40_000_000, insurerShare: 0, patientShare: 40_000_000 },
    ];
    const c = ctx({ sales: directSales });
    const doc = base({ id: 7, rxPerDay: 10, avgRxAmount: 5_000_000, insurerMix: { 1: 0.8, 0: 0.2 } });
    const f = forecastDoctor(doc, [], c);
    const ins1 = f.byInsurer.find((r) => r.key === 1)!;
    const free = f.byInsurer.find((r) => r.key === 0)!;
    expect(ins1.sales).toBeCloseTo(60_000_000);
    expect(ins1.insurer).toBeCloseTo(50_000_000);
    expect(ins1.patient).toBeCloseTo(10_000_000);
    expect(free.sales).toBeCloseTo(40_000_000);
    expect(free.insurer).toBeCloseTo(0);
    expect(free.patient).toBeCloseTo(40_000_000);
    expect(f.byInsurer.reduce((s, r) => s + r.sales, 0)).toBeCloseTo(f.sales);
    expect(f.byInsurer.reduce((s, r) => s + r.insurer, 0)).toBeCloseTo(f.insurer);
  });
});

describe('جمع و مصرف', () => {
  it('مصرف دارو جمع پزشکان است', () => {
    const c = ctx();
    const a = forecastDoctor(base({ name: 'الف' }), [{ drugId: 1, rxShare: 0.2, qtyPerRx: 1 }], c);
    const b = forecastDoctor(base({ name: 'ب' }), [{ drugId: 1, rxShare: 0.1, qtyPerRx: 2 }], c);
    const [use] = drugConsumption([a, b], c);
    expect(use.use).toBeCloseTo(350);
    expect(use.doctors).toHaveLength(2);
    expect(totalsOf([a, b]).net).toBeCloseTo(87500000);
  });
  it('روز کاری از روزهای هفته', () => {
    expect(workDaysFromWeek([0, 1, 2, 3, 4, 5])).toBe(26);
    expect(workDaysFromWeek([0, 1, 2, 4])).toBe(17);
  });
});
