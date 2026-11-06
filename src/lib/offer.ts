import { bonusUnits, earlyPayDiscount, effectiveUnitCost, presentValue } from './calc';

// ارزیاب آفر شرکت پخش. همه‌چیز تابع خالص است.
// زمان بر حسب ماه از امروز است: ماه صفر یعنی الان. مبلغ‌ها ریال، درصدها کسر.

export interface MixRow {
  key: number;
  name: string;
  /** سهم این بیمه از بیماران این دارو */
  share: number;
  /** سهم بیمه از قیمت */
  rate: number;
  delay: number;
  deduction: number;
}

export interface OfferInput {
  price: number;
  consumerPrice: number;
  qty: number;
  everyX: number;
  freeY: number;
  baseMonths: number;
  discountPerMonth: number;
  stock: number;
  monthsToExpiry: number;
  safetyMonths: number;
  monthlyUse: number;
  r: number;
  mix: MixRow[];
  /** سناریوی مبنا: خرید عادی */
  normalPrice: number;
  normalMonths: number;
  normalQty: number;
}

export interface Flow {
  month: number;
  amount: number;
}

export const SENSITIVITY_RATES = [0, 0.02, 0.03, 0.04, 0.05, 0.06];

export const present = (flows: Flow[], r: number) => flows.reduce((s, f) => s + presentValue(f.amount, r, f.month), 0);

/** تعداد کل دریافتی = Q + floor(Q ÷ X) × Y */
export const totalUnits = (i: Pick<OfferInput, 'everyX' | 'freeY'>, qty: number) => qty + bonusUnits(qty, i.everyX, i.freeY);

/** ماه‌های لازم برای فروش = (موجودی فعلی + تعداد کل) ÷ مصرف ماهانه */
export const monthsToSell = (i: OfferInput, qty: number) =>
  i.monthlyUse > 0 ? (i.stock + totalUnits(i, qty)) / i.monthlyUse : Infinity;

/** تعدادی از این خرید که تا تاریخ انقضا فروش می‌رود. */
export function sellableUnits(i: OfferInput, qty: number): number {
  return Math.min(totalUnits(i, qty), Math.max(0, i.monthlyUse * i.monthsToExpiry - i.stock));
}

/** بررسی انقضا: اگر فروش از (ماه تا انقضا − حاشیهٔ امن) بیشتر طول بکشد، هشدار. */
export function expiryCheck(i: OfferInput, qty: number) {
  const limit = i.monthsToExpiry - i.safetyMonths;
  const months = monthsToSell(i, qty);
  return { months, limit, risky: months > limit, unsold: totalUnits(i, qty) - sellableUnits(i, qty) };
}

/** برنامهٔ فروش: موجودی فعلی اول فروش می‌رود، بعد این واحدها؛ ماه k یعنی فروش در طول ماه k. */
function salesPlan(i: OfferInput, units: number): { month: number; units: number }[] {
  const plan: { month: number; units: number }[] = [];
  if (i.monthlyUse <= 0) return plan;
  let stock = i.stock;
  let left = units;
  for (let month = 0; left > 1e-9 && month < 600; month++) {
    const fromStock = Math.min(stock, i.monthlyUse);
    stock -= fromStock;
    const sold = Math.min(left, i.monthlyUse - fromStock);
    if (sold > 0) plan.push({ month, units: sold });
    left -= sold;
  }
  return plan;
}

/** درآمد هر واحد: سهم بیمار در ماه فروش و سهم بیمه L ماه بعد با کسر کسورات. */
export function unitRevenue(i: OfferInput) {
  let cash = 0;
  const later: { delay: number; amount: number }[] = [];
  for (const row of i.mix) {
    const insurer = row.rate * i.consumerPrice * row.share;
    cash += i.consumerPrice * row.share - insurer;
    if (insurer > 0) later.push({ delay: row.delay, amount: insurer * (1 - row.deduction) });
  }
  return { cash, later };
}

/** جریان درآمد؛ فروش در پایان هر ماه است. */
export function revenueFlows(i: OfferInput, units: number): Flow[] {
  const { cash, later } = unitRevenue(i);
  const flows: Flow[] = [];
  for (const sale of salesPlan(i, units)) {
    const month = sale.month + 1;
    flows.push({ month, amount: sale.units * cash });
    for (const part of later) flows.push({ month: month + part.delay, amount: sale.units * part.amount });
  }
  return flows;
}

/** پرداخت‌های خرید عادی: هر ماه به اندازهٔ لازم در ابتدای ماه، با چک. */
export function normalPayments(i: OfferInput, units: number): Flow[] {
  const flows: Flow[] = [];
  const perMonth = i.normalQty > 0 ? i.normalQty : i.monthlyUse;
  if (perMonth <= 0) return flows;
  const start = i.monthlyUse > 0 ? Math.floor(i.stock / i.monthlyUse) : 0;
  let left = units;
  for (let k = start; left > 1e-9; k++) {
    const buy = Math.min(perMonth, left);
    flows.push({ month: k + i.normalMonths, amount: buy * i.normalPrice });
    left -= buy;
  }
  return flows;
}

export interface PaymentOption {
  month: number;
  discount: number;
  paid: number;
  unitCost: number;
  advantage: number;
  breakEven: number | null;
}

const paymentOf = (i: OfferInput, qty: number, month: number) =>
  qty * i.price * (1 - earlyPayDiscount(i.discountPerMonth, i.baseMonths, month));

/** مزیت ارزش فعلی آفر نسبت به مبنا. درآمد دو سناریو یکی است، پس فقط پرداخت‌ها فرق می‌کند. */
export function advantage(i: OfferInput, qty: number, month: number, r: number): number {
  const sold = sellableUnits(i, qty);
  return present(normalPayments(i, sold), r) - presentValue(paymentOf(i, qty, month), r, month);
}

/** نرخ سربه‌سر با روش دوبخشی: نرخی که مزیت صفر می‌شود؛ اگر در بازه تغییر علامت نبود، تهی. */
export function breakEvenRate(f: (r: number) => number, low = 0, high = 1): number | null {
  let a = low;
  let b = high;
  let fa = f(a);
  const fb = f(b);
  if (fa === 0) return a;
  if (fa * fb > 0) return null;
  for (let n = 0; n < 200 && b - a > 1e-10; n++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fa * fm <= 0) b = mid;
    else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** گزینه‌های پرداخت: برای هر m از ۰ تا M */
export function paymentOptions(i: OfferInput, qty: number): PaymentOption[] {
  const out: PaymentOption[] = [];
  for (let month = 0; month <= i.baseMonths; month++) {
    const paid = paymentOf(i, qty, month);
    out.push({
      month,
      discount: earlyPayDiscount(i.discountPerMonth, i.baseMonths, month),
      paid,
      unitCost: effectiveUnitCost(paid, qty, totalUnits(i, qty) - qty),
      advantage: advantage(i, qty, month, i.r),
      breakEven: breakEvenRate((r) => advantage(i, qty, month, r)),
    });
  }
  return out;
}

export function sensitivity(i: OfferInput, qty: number, month: number) {
  return SENSITIVITY_RATES.map((r) => ({ r, advantage: advantage(i, qty, month, r) }));
}

/** سود ارزش فعلی کل خرید با این گزینه: آیا اصلاً این خرید سود دارد؟ */
export function presentProfit(i: OfferInput, qty: number, month: number): number {
  return present(revenueFlows(i, sellableUnits(i, qty)), i.r) - presentValue(paymentOf(i, qty, month), i.r, month);
}

/** فرق جریان نقد با خرید عادی: پرداخت آفر به‌جای پرداخت‌های عادی. مثبت یعنی خروج بیشتر. */
export function cashDelta(i: OfferInput, qty: number, month: number): Flow[] {
  return [
    { month, amount: paymentOf(i, qty, month) },
    ...normalPayments(i, sellableUnits(i, qty)).map((f) => ({ month: f.month, amount: -f.amount })),
  ];
}

/** موجودی پایان ماه‌های پیش‌بینی بعد از این آفر؛ offset یعنی ماه صفر آفر کدام خانهٔ پیش‌بینی است. */
export function endsAfter(ends: number[], offset: number, delta: Flow[]): number[] {
  return ends.map((end, index) => {
    const elapsed = index - offset;
    if (elapsed < 0) return end;
    return end - delta.filter((f) => f.month <= elapsed).reduce((s, f) => s + f.amount, 0);
  });
}

export interface CashContext {
  /** موجودی پایان ماه‌های مرحلهٔ ۵ */
  ends: number[];
  offset: number;
  minSafe: number;
  /** وقتی پیش‌بینی داده ندارد، نقدینگی محدودیت نمی‌گذارد. */
  active: boolean;
}

export function liquidity(i: OfferInput, qty: number, month: number, cash: CashContext) {
  const before = cash.ends.length ? Math.min(...cash.ends) : 0;
  const after = cash.ends.length ? Math.min(...endsAfter(cash.ends, cash.offset, cashDelta(i, qty, month))) : 0;
  // اگر از قبل زیر حداقل امن باشیم، آفر نباید وضع را بدتر کند.
  const ok = !cash.active || after >= cash.minSafe || after >= before - 0.5;
  return { before, after, ok };
}

/** بیشترین تعدادی که با حاشیهٔ امن انقضا فروش می‌رود. */
export function qtyCap(i: OfferInput): number {
  const room = Math.max(0, (i.monthsToExpiry - i.safetyMonths) * i.monthlyUse - i.stock);
  const step = stepOf(i);
  let best = 0;
  for (let q = step; totalUnits(i, q) <= room; q += step) best = q;
  return best;
}

const stepOf = (i: OfferInput) => (i.everyX > 0 ? i.everyX : Math.max(1, Math.round(i.monthlyUse)));

export interface Choice {
  qty: number;
  month: number;
  advantage: number;
}

/** بهترین ماه پرداخت برای یک تعداد، با رعایت نقدینگی. */
export function bestMonth(i: OfferInput, qty: number, cash: CashContext): Choice | null {
  let best: Choice | null = null;
  for (let month = 0; month <= i.baseMonths; month++) {
    if (!liquidity(i, qty, month, cash).ok) continue;
    const value = advantage(i, qty, month, i.r);
    if (!best || value > best.advantage) best = { qty, month, advantage: value };
  }
  return best;
}

/** تعداد بهینه: همهٔ مضرب‌های X تا سقف انقضا و همهٔ ماه‌های پرداخت. */
export function optimize(i: OfferInput, cash: CashContext): Choice | null {
  const cap = qtyCap(i);
  const step = stepOf(i);
  let best: Choice | null = null;
  for (let q = step; q <= cap; q += step) {
    const choice = bestMonth(i, q, cash);
    if (!choice || presentProfit(i, q, choice.month) <= 0) continue;
    if (!best || choice.advantage > best.advantage) best = choice;
  }
  return best;
}

export type VerdictKind = 'buy' | 'limit' | 'no';

export interface Verdict {
  kind: VerdictKind;
  qty: number;
  month: number;
  advantage: number;
  /** بهترین تعداد کلی، اگر با تعداد پیشنهادی فرق داشته باشد */
  optimal: Choice | null;
}

/** حکم: تعداد پیشنهادی اگر امن است همان، وگرنه بهترین تعداد مجاز. */
export function decide(i: OfferInput, cash: CashContext): Verdict {
  const optimal = optimize(i, cash);
  const risky = expiryCheck(i, i.qty).risky;
  const proposed = risky ? null : bestMonth(i, i.qty, cash);
  // خریدی که با احتساب تأخیر بیمه زیان می‌دهد، حتی اگر از خرید عادی بهتر باشد، «بخرید» نمی‌گیرد.
  if (proposed && proposed.advantage > 0 && presentProfit(i, proposed.qty, proposed.month) > 0) {
    return { kind: 'buy', qty: proposed.qty, month: proposed.month, advantage: proposed.advantage, optimal };
  }
  if (optimal && optimal.advantage > 0) {
    return { kind: 'limit', qty: optimal.qty, month: optimal.month, advantage: optimal.advantage, optimal };
  }
  return { kind: 'no', qty: 0, month: 0, advantage: proposed?.advantage ?? optimal?.advantage ?? 0, optimal };
}

/** عبارت روش پرداخت برای حکم */
export function paymentPhrase(i: OfferInput, month: number): string {
  const bonus = i.everyX > 0 && i.freeY > 0;
  const fa = (n: number) => n.toLocaleString('fa-IR');
  if (month === 0) return bonus ? 'با پرداخت نقد و گرفتن بونوس' : 'با پرداخت نقد';
  if (month === i.baseMonths) return `با چک ${fa(month)} ماهه${bonus ? ' و گرفتن بونوس' : ''}`;
  return `با پرداخت در ماه ${fa(month)}${bonus ? ' و گرفتن بونوس' : ''}`;
}

export function verdictText(i: OfferInput, v: Verdict): string {
  if (v.kind === 'no') return 'نخرید';
  const phrase = paymentPhrase(i, v.month);
  if (v.kind === 'buy') return `بخرید، ${phrase}`;
  return `بخرید ولی فقط ${v.qty.toLocaleString('fa-IR')} عدد، ${phrase}`;
}

/** جریان نقد انباشتهٔ هر ماه، برای نمودار */
export function cumulative(flows: Flow[], months: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let m = 0; m <= months; m++) {
    sum += flows.filter((f) => f.month === m).reduce((s, f) => s + f.amount, 0);
    out.push(sum);
  }
  return out;
}

export function offerCashSeries(i: OfferInput, qty: number, month: number) {
  const sold = sellableUnits(i, qty);
  const revenue = revenueFlows(i, sold);
  const normal = normalPayments(i, sold);
  const offer: Flow[] = [...revenue, { month, amount: -paymentOf(i, qty, month) }];
  const base: Flow[] = [...revenue, ...normal.map((f) => ({ month: f.month, amount: -f.amount }))];
  const last = Math.max(...offer.map((f) => f.month), ...base.map((f) => f.month), 1);
  return { offer: cumulative(offer, last), base: cumulative(base, last) };
}
