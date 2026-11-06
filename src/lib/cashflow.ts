import { average } from './calc';
import type {
  Cheque, Doctor, DoctorDrugProfile, FixedCost, Insurer, Invoice, InvoiceItem, OneOffCost, Settings,
} from './db';
import { forecastDoctor, FREE_KEY, type DoctorForecast, type ForecastContext } from './doctors';
import { jalaliParts, monthKey, monthLabel } from './jalali';

// پیش‌بینی نقدینگی و سود و زیان. هر تابع خالص است؛ تست فشار و سناریو فقط ورودی را عوض می‌کنند.
// مبلغ‌ها ریال، درصدها کسر، زمان ماه. ماه ۱ همان ماه شروع فعالیت است.

export interface CashPolicy {
  /** افق پیش‌بینی به ماه: ۱۲ تا ۳۶ */
  horizon: number;
  /** سهم خرید نقدی؛ بقیه چکی است */
  cashShare: number;
  chequeMonths: number;
  stockDays: number;
  /** درصد سود از فاکتورهای واقعی گرفته شود یا عدد دستی */
  marginFromInvoices: boolean;
  margin: number;
}

export const DEFAULT_POLICY: CashPolicy = {
  horizon: 24, cashShare: 0, chequeMonths: 3, stockDays: 30, marginFromInvoices: true, margin: 0.18,
};

export interface Stress {
  extraDelay: number;
  salesDrop: number;
}

export const NO_STRESS: Stress = { extraDelay: 0, salesDrop: 0 };

export interface SalesStream {
  key: number | string;
  name: string;
  startMonth: string;
  rx: number;
  rent: number;
  allowance: number;
  byInsurer: { key: number; name: string; share: number; sales: number; insurer: number }[];
}

export interface CashInsurer {
  key: number;
  name: string;
  delay: number;
  deduction: number;
}

export interface CashInputs {
  startMonth: string;
  openingCash: number;
  minSafe: number;
  policy: CashPolicy;
  /** درصد سود روی فروش که واقعاً به کار می‌رود */
  margin: number;
  technicalFee: number;
  technicalFeeInsurerShare: number;
  streams: SalesStream[];
  insurers: CashInsurer[];
  fixed: { title: string; monthly: number; startMonth: string; endMonth?: string }[];
  oneOff: { title: string; amount: number; month: string }[];
  /** چک‌های ثبت‌شده (مرحلهٔ ۳) */
  cheques: { month: string; amount: number }[];
  /** خریدهای ثبت‌شده؛ از خرید پیش‌بینی‌شدهٔ همان ماه کم می‌شود تا دوبار حساب نشود */
  purchases: { month: string; total: number; cash: number }[];
}

export interface CashMonth {
  index: number;
  key: string;
  sales: number;
  insurerShare: number;
  patientShare: number;
  feeTotal: number;
  feePatient: number;
  feeInsurer: number;
  collections: Map<number, number>;
  collected: number;
  inflow: number;
  cogs: number;
  purchase: number;
  cashPurchase: number;
  forecastCheque: number;
  registeredCheque: number;
  registeredCash: number;
  fixed: number;
  doctorCosts: number;
  oneOff: number;
  outflow: number;
  start: number;
  end: number;
  claims: Map<number, number>;
  receivable: Map<number, number>;
  receivableTotal: number;
  deductions: number;
  netProfit: number;
  byDoctor: { key: number | string; name: string; sales: number; cogs: number; deductions: number; costs: number; net: number }[];
  byInsurer: { key: number; name: string; sales: number; insurer: number; deductions: number }[];
}

/** ماه شمسی بعد از n ماه: «1405-11» + 3 ← «1406-02» */
export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

const inRange = (key: string, from: string, to?: string) => key >= from && (!to || key <= to);

/** محاسبهٔ ماه‌به‌ماه. */
export function runCash(input: CashInputs, stress: Stress = NO_STRESS): CashMonth[] {
  const { policy, margin } = input;
  const H = policy.horizon;
  const keep = 1 - stress.salesDrop;
  const delays = new Map(input.insurers.map((i) => [i.key, Math.round(i.delay + stress.extraDelay)]));
  const deductions = new Map(input.insurers.map((i) => [i.key, i.deduction]));
  const names = new Map(input.insurers.map((i) => [i.key, i.name]));

  const months: CashMonth[] = [];
  const claimsByMonth: Map<number, number>[] = [new Map()]; // خانهٔ صفر استفاده نمی‌شود
  const chequeDue = new Array(H + 1 + 80).fill(0);
  let stock = 0;
  let cash = input.openingCash;

  for (let t = 1; t <= H; t++) {
    const key = shiftMonth(input.startMonth, t - 1);
    const claims = new Map<number, number>();
    const byInsurer = new Map<number, CashMonth['byInsurer'][number]>();
    const byDoctor: CashMonth['byDoctor'] = [];
    let sales = 0;
    let insurerShare = 0;
    let feeTotal = 0;
    let feeInsurer = 0;
    let doctorCosts = 0;

    for (const stream of input.streams) {
      if (key < stream.startMonth) continue;
      let streamSales = 0;
      let streamDeductions = 0;
      for (const part of stream.byInsurer) {
        const partSales = part.sales * keep;
        const partInsurer = part.insurer * keep;
        const fee = input.technicalFee * stream.rx * part.share * keep;
        const insured = part.key !== FREE_KEY;
        const partFeeInsurer = insured ? fee * input.technicalFeeInsurerShare : 0;
        streamSales += partSales;
        sales += partSales;
        insurerShare += partInsurer;
        feeTotal += fee;
        feeInsurer += partFeeInsurer;
        if (insured) claims.set(part.key, (claims.get(part.key) ?? 0) + partInsurer + partFeeInsurer);
        const lost = (partInsurer + partFeeInsurer) * (deductions.get(part.key) ?? 0);
        streamDeductions += lost;
        const row = byInsurer.get(part.key) ?? { key: part.key, name: part.name, sales: 0, insurer: 0, deductions: 0 };
        row.sales += partSales;
        row.insurer += partInsurer + partFeeInsurer;
        row.deductions += lost;
        byInsurer.set(part.key, row);
      }
      const costs = stream.rent + stream.allowance;
      doctorCosts += costs;
      const streamCogs = streamSales * (1 - margin);
      byDoctor.push({
        key: stream.key, name: stream.name, sales: streamSales, cogs: streamCogs, deductions: streamDeductions, costs,
        net: streamSales - streamCogs - streamDeductions - costs,
      });
    }
    claimsByMonth[t] = claims;

    // وصولی بیمه: طلب ماه (t − تأخیر) × (۱ − کسورات)
    const collections = new Map<number, number>();
    for (const [insurerKey, delay] of delays) {
      const source = t - delay;
      if (source < 1) continue;
      const claim = claimsByMonth[source]?.get(insurerKey) ?? 0;
      if (claim) collections.set(insurerKey, claim * (1 - (deductions.get(insurerKey) ?? 0)));
    }
    const collected = [...collections.values()].reduce((a, b) => a + b, 0);

    // خرید = بهای تمام‌شدهٔ فروش ماه + تغییر موجودی لازم
    const cogs = sales * (1 - margin);
    const target = cogs * (policy.stockDays / 30);
    const planned = Math.max(0, cogs + target - stock);
    stock = target;
    const registered = input.purchases.filter((p) => p.month === key);
    const purchase = Math.max(0, planned - registered.reduce((s, p) => s + p.total, 0));
    const cashPurchase = purchase * policy.cashShare;
    const chequed = purchase - cashPurchase;
    if (policy.chequeMonths === 0) chequeDue[t] += chequed;
    else if (t + policy.chequeMonths < chequeDue.length) chequeDue[t + policy.chequeMonths] += chequed;

    const registeredCheque = input.cheques.filter((c) => c.month === key).reduce((s, c) => s + c.amount, 0);
    const registeredCash = registered.reduce((s, p) => s + p.cash, 0);
    const fixed = input.fixed.filter((f) => inRange(key, f.startMonth, f.endMonth)).reduce((s, f) => s + f.monthly, 0);
    const oneOff = input.oneOff.filter((o) => o.month === key).reduce((s, o) => s + o.amount, 0);

    const patientShare = sales - insurerShare;
    const feePatient = feeTotal - feeInsurer;
    const inflow = patientShare + feePatient + collected;
    const outflow = cashPurchase + registeredCash + chequeDue[t] + registeredCheque + fixed + doctorCosts + oneOff;
    const start = cash;
    cash = start + inflow - outflow;

    // طلب پایان ماه: طلب‌هایی که هنوز سررسید وصولشان نرسیده است
    const receivable = new Map<number, number>();
    for (const [insurerKey, delay] of delays) {
      let open = 0;
      for (let u = Math.max(1, t - delay + 1); u <= t; u++) open += claimsByMonth[u]?.get(insurerKey) ?? 0;
      if (open) receivable.set(insurerKey, open);
    }
    const lostToDeductions = [...claims].reduce((s, [k, v]) => s + v * (deductions.get(k) ?? 0), 0);

    months.push({
      index: t, key, sales, insurerShare, patientShare, feeTotal, feePatient, feeInsurer, collections, collected, inflow,
      cogs, purchase, cashPurchase, forecastCheque: chequeDue[t], registeredCheque, registeredCash, fixed, doctorCosts, oneOff,
      outflow, start, end: cash, claims, receivable,
      receivableTotal: [...receivable.values()].reduce((a, b) => a + b, 0),
      deductions: lostToDeductions,
      netProfit: sales + feeTotal - cogs - lostToDeductions - fixed - doctorCosts,
      byDoctor,
      byInsurer: [...byInsurer.values()].map((r) => ({ ...r, name: names.get(r.key) ?? r.name })),
    });
  }
  return months;
}

export const firstBelow = (months: CashMonth[], level: number) => months.find((m) => m.end < level);

export const lowestMonth = (months: CashMonth[]) => months.reduce((a, b) => (b.end < a.end ? b : a), months[0]);

/** حداقل سرمایهٔ اضافه برای اینکه هیچ ماهی زیر حداقل امن نرود. */
export function capitalNeeded(months: CashMonth[], minSafe: number): number {
  return months.length ? Math.max(0, minSafe - lowestMonth(months).end) : 0;
}

/** کوتاه‌ترین مدت چکی که با آن هیچ ماهی زیر حداقل امن نمی‌رود؛ اگر نبود تهی. */
export function chequeTermNeeded(input: CashInputs, stress: Stress = NO_STRESS, longest = 24): number | null {
  for (let term = 0; term <= longest; term++) {
    const months = runCash({ ...input, policy: { ...input.policy, chequeMonths: term } }, stress);
    if (lowestMonth(months).end >= input.minSafe) return term;
  }
  return null;
}

export type ShortageCause = 'insurer' | 'loss' | 'purchases';

export const CAUSE_TEXT: Record<ShortageCause, string> = {
  insurer: 'تأخیر بیمه؛ طلب شما هنوز وصول نشده ولی چک خرید سررسید شده است',
  loss: 'هزینه‌ها از سود بیشتر است',
  purchases: 'خرید و چک‌های این دوره از پول ورودی بیشتر است',
};

/** علت اصلی کمبود: اگر طلب وصول‌نشده کمبود را می‌پوشاند، تأخیر بیمه علت است. */
export function shortageCause(months: CashMonth[], month: CashMonth, level: number, input: CashInputs): ShortageCause {
  const gap = level - month.end;
  const deduction = new Map(input.insurers.map((i) => [i.key, i.deduction]));
  const waiting = [...month.receivable].reduce((s, [k, v]) => s + v * (1 - (deduction.get(k) ?? 0)), 0);
  if (waiting >= gap) return 'insurer';
  const profit = months.filter((m) => m.index <= month.index).reduce((s, m) => s + m.netProfit, 0);
  return profit < 0 ? 'loss' : 'purchases';
}

/** میانگین سود روی فروش اقلام خریداری‌شده، با وزن مبلغ فروش هر سطر. */
export function invoiceMargin(items: InvoiceItem[]): number | null {
  let value = 0;
  let cost = 0;
  for (const item of items) {
    const units = item.quantity + item.bonus;
    if (item.consumerPrice <= 0 || units <= 0) continue;
    value += item.consumerPrice * units;
    cost += item.total;
  }
  return value > 0 ? (value - cost) / value : null;
}

const monthOfDate = (iso: string) => {
  const { y, m } = jalaliParts(iso);
  return monthKey(y, m);
};

export function streamOf(f: DoctorForecast, key: number | string): SalesStream {
  return {
    key,
    name: f.doctor.name,
    startMonth: f.doctor.startMonth,
    rx: f.rx,
    rent: f.rent,
    allowance: f.allowance,
    byInsurer: f.byInsurer.map(({ key: k, name, share, sales, insurer }) => ({ key: k, name, share, sales, insurer })),
  };
}

/** ورودی موتور نقدینگی از داده‌های برنامه. */
export function buildCashInputs(data: {
  settings: Settings;
  ctx: ForecastContext;
  doctors: Doctor[];
  profiles: DoctorDrugProfile[];
  insurers: Insurer[];
  fixedCosts: FixedCost[];
  oneOffCosts: OneOffCost[];
  cheques: Cheque[];
  invoices: Invoice[];
  items: InvoiceItem[];
}): CashInputs {
  const { settings } = data;
  const policy = { ...DEFAULT_POLICY, margin: settings.defaultMarginRate ?? DEFAULT_POLICY.margin, ...settings.cashPolicy };
  const start = settings.startMonth;
  const fromInvoices = policy.marginFromInvoices ? invoiceMargin(data.items) : null;
  const margin = fromInvoices ?? policy.margin;

  const chequeTotal = new Map<number, number>();
  for (const c of data.cheques) {
    if (c.invoiceId) chequeTotal.set(c.invoiceId, (chequeTotal.get(c.invoiceId) ?? 0) + c.amount);
  }
  const cheques = data.cheques.flatMap((c) => {
    const month = monthOfDate(c.dueDate);
    if (month >= start) return [{ month, amount: c.amount }];
    // چک پرداخت‌نشدهٔ قبل از شروع، در ماه اول باید پرداخت شود.
    return c.status === 'pending' ? [{ month: start, amount: c.amount }] : [];
  });

  return {
    startMonth: start,
    openingCash: settings.openingCash,
    minSafe: settings.minSafeCash,
    policy,
    margin,
    technicalFee: settings.technicalFee,
    technicalFeeInsurerShare: settings.technicalFeeInsurerShare,
    streams: data.doctors
      .filter((d) => d.active)
      .map((d) => streamOf(forecastDoctor(d, data.profiles.filter((p) => p.doctorId === d.id), data.ctx), d.id)),
    insurers: data.insurers.map((i) => ({ key: i.id, name: i.name, delay: i.delayMonths, deduction: i.deductionRate })),
    fixed: data.fixedCosts.map((f) => ({
      title: f.title, monthly: f.amount * (f.pharmacyShare ?? 1), startMonth: f.startMonth, endMonth: f.endMonth,
    })),
    oneOff: data.oneOffCosts.map((o) => ({ title: o.title, amount: o.amount, month: o.month })),
    cheques,
    purchases: data.invoices.map((i) => ({
      month: monthOfDate(i.date),
      total: i.payable,
      cash: Math.max(0, i.payable - (chequeTotal.get(i.id) ?? 0)),
    })),
  };
}

export interface Warning {
  month: CashMonth;
  gap: number;
  level: 'short' | 'warn';
  cause: ShortageCause;
}

/** اولین ماهی که موجودی منفی یا زیر حداقل امن می‌شود. */
export function firstWarning(months: CashMonth[], input: CashInputs): Warning | null {
  const month = firstBelow(months, Math.max(0, input.minSafe));
  if (!month) return null;
  const short = month.end < 0;
  const level = short ? 0 : input.minSafe;
  return { month, gap: level - month.end, level: short ? 'short' : 'warn', cause: shortageCause(months, month, level, input) };
}

export const warningHead = (w: Warning) => `در ${monthLabel(w.month.key)}`;

export const averageNet = (months: CashMonth[]) => average(months.map((m) => m.netProfit));
