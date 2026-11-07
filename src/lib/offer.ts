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

/** خروجی استخراج هوشمند از متن آفر (مثلاً «۱۰۰ عدد بخر ۲۰ عدد آفر چک ۶ ماهه») */
export interface ParsedOfferText {
  buyQty?: number;
  freeQty?: number;
  chequeMonths?: number;
  discountPerMonth?: number;
  /** تخفیف کل نقدی به شکل کسر (مثلاً 0.12 برای ۱۲٪ تخفیف نقدی) */
  cashDiscount?: number;
  /** آیا نوع تخفیف در متن مبهم بوده و ماهانه فرض شده است؟ */
  discountAmbiguous?: boolean;
}

/**
 * استخراج خودکار تعداد خرید، تعداد آفر رایگان، مهلت چک (ماه یا روز) و تخفیف از متن فارسی یا انگلیسی.
 * قواعد تخفیف:
 * ۱. اگر درصد تخفیف کنار «نقد» یا «نقدی» باشد و واژه‌های ماهانه («ماهانه»، «در ماه»، «هر ماه»، «ماهی») کنارش نباشد:
 *    تخفیف کل نقدی (cashDiscount) است و اگر chequeMonths > 0 معلوم باشد، discountPerMonth = cashDiscount ÷ chequeMonths.
 * ۲. اگر واژه‌های ماهانه کنارش باشد، تخفیف ماهانه (discountPerMonth) است.
 * ۳. اگر هیچ‌کدام کنارش نباشد، ماهانه فرض می‌شود و discountAmbiguous: true برمی‌گردد.
 * ۴. «N روزه» و «N روز» با فرمول Math.round(N ÷ 30) به ماه تبدیل می‌شوند.
 */
export function parseOfferText(raw: string): ParsedOfferText {
  const faDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arDigits = '٠١٢٣٤٥٦٧٨٩';
  const text = String(raw ?? '')
    .replace(/[۰-۹٠-٩]/g, (d) => {
      const f = faDigits.indexOf(d);
      return String(f >= 0 ? f : arDigits.indexOf(d));
    })
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[,٬،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return {};
  const out: ParsedOfferText = {};

  // ۱. الگوی کوتاه X + Y (مثلاً 100+20 یا 100 + 20)
  const plusMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)(?=\s|$|[^\d.])/);
  if (plusMatch) {
    out.buyQty = Number(plusMatch[1]);
    out.freeQty = Number(plusMatch[2]);
  }

  // بررسی وجود درصد تخفیف در متن
  const discMatch =
    text.match(/تخفیف[^\d]*(\d+(?:\.\d+)?)\s*(?:%|٪|درصد)/) ??
    text.match(/(\d+(?:\.\d+)?)\s*(?:%|٪|درصد)\s*تخفیف/) ??
    text.match(/(?:نقد|نقدی)[^\d]*(\d+(?:\.\d+)?)\s*(?:%|٪|درصد)/);

  // ۲. استخراج مهلت چک بر حسب ماه یا روز (تبدیل روز به ماه: Math.round(N ÷ 30))
  const monthMatch =
    text.match(/(?:چک|مهلت|راس|رأس|تسویه|مدت)\s*(?:هم\s*)?(?:مهلت\s*)?(\d+(?:\.\d+)?)\s*ماه/) ??
    text.match(/(\d+(?:\.\d+)?)\s*ماهه/) ??
    text.match(/(\d+(?:\.\d+)?)\s*ماه(?:\s|$)/);
  const dayMatch =
    text.match(/(?:چک|مهلت|راس|رأس|تسویه|مدت)\s*(?:هم\s*)?(?:مهلت\s*)?(\d+(?:\.\d+)?)\s*روزه?/) ??
    text.match(/(\d+(?:\.\d+)?)\s*روزه/) ??
    text.match(/(\d+(?:\.\d+)?)\s*روز(?:\s|$)/);

  if (monthMatch) {
    out.chequeMonths = Math.round(Number(monthMatch[1]));
  } else if (dayMatch) {
    out.chequeMonths = Math.round(Number(dayMatch[1]) / 30);
  } else if (/(?:^|\s)(?:نقد|نقدی)(?:\s|$)/.test(text) && !discMatch) {
    out.chequeMonths = 0;
  }

  // ۳. استخراج تخفیف زودپرداخت و تشخیص نوع آن (نقدی کل، ماهانه، یا مبهم)
  if (discMatch) {
    const rate = Number(discMatch[1]) / 100;
    const hasMonthly = /(?:ماهانه|در\s*ماه|هر\s*ماه|(?:^|\s)ماهی(?:\s|$|\d))/.test(text);
    const hasCash = /(?:^|\s)(?:نقد|نقدی)(?:\s|$)/.test(text);

    if (hasMonthly) {
      out.discountPerMonth = rate;
    } else if (hasCash) {
      out.cashDiscount = rate;
      if (out.chequeMonths !== undefined && out.chequeMonths > 0) {
        out.discountPerMonth = Number((rate / out.chequeMonths).toFixed(8));
      }
    } else {
      out.discountPerMonth = rate;
      out.discountAmbiguous = true;
    }
  }

  // ۴. اگر الگوی X+Y نبود، استخراج تعداد خرید و تعداد آفر از متن طبیعی
  if (out.buyQty === undefined || out.freeQty === undefined) {
    const buyMatch =
      text.match(/(\d+(?:\.\d+)?)\s*(?:عدد|تا|بسته|جعبه|ورق)?\s*(?:بخر\w*|خرید\w*|سفارش)/) ??
      text.match(/(?:خرید|سفارش|به ازای(?:\s*هر)?)\s*(\d+(?:\.\d+)?)\s*(?:عدد|تا|بسته|جعبه)?/);
    const freeMatch =
      text.match(/(\d+(?:\.\d+)?)\s*(?:عدد|تا|بسته|جعبه|ورق)?\s*(?:آفر|افر|رایگان|جایزه|بونوس|هدیه|اشانتیون)/) ??
      text.match(/(?:آفر|افر|رایگان|جایزه|بونوس|هدیه)\s*(\d+(?:\.\d+)?)\s*(?:عدد|تا|بسته|جعبه)?/) ??
      text.match(/(?:بهت|به شما|می‌دهم|میدهم|میده|بگیر\w*)\s*(\d+(?:\.\d+)?)\s*(?:عدد|تا)?\s*(?:آفر|افر|رایگان|جایزه|بونوس)?/);

    if (buyMatch && out.buyQty === undefined) out.buyQty = Number(buyMatch[1]);
    if (freeMatch && out.freeQty === undefined) out.freeQty = Number(freeMatch[1]);

    // اگر هنوز هر دو پیدا نشده‌اند و دو عدد اول جمله قبل از ماه/روز چک آمده‌اند
    if (out.buyQty === undefined || out.freeQty === undefined) {
      const cleaned = text
        .replace(/(?:چک|مهلت|راس|رأس|تسویه|مدت)?\s*\d+(?:\.\d+)?\s*(?:ماهه?|روزه?)/g, ' ')
        .replace(/\d+(?:\.\d+)?\s*(?:%|٪|درصد)/g, ' ');
      const nums = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      if (nums.length >= 2) {
        if (out.buyQty === undefined) out.buyQty = nums[0];
        if (out.freeQty === undefined) out.freeQty = nums[1];
      }
    }
  }

  return out;
}

export interface QuickOfferRow {
  id: string;
  title: string;
  rawText: string;
  buyQty: number;
  freeQty: number;
  chequeMonths: number;
  discountPerMonth: number;
  cashDiscount?: number;
  discountAmbiguous?: boolean;
  needsChequeMonthsForCashDiscount?: boolean;
  priceOverride?: number;
}

export interface QuickCompareContext {
  /** مصرف ماهانهٔ داروخانه از این دارو */
  monthlyUse: number;
  /** قیمت خرید واحد (فی) پایه به ریال؛ اگر ۰ باشد روی پایهٔ فرضی ۱۰۰٬۰۰۰ ریال سنجیده می‌شود */
  unitPrice: number;
  /** هزینهٔ پول ماهانه (کسر، مثلاً 0.03) */
  r: number;
  /** مدت چک خرید عادی مبنا (ماه) */
  normalMonths: number;
  /** ماه تا انقضا */
  monthsToExpiry: number;
  /** حاشیهٔ امن انقضا (ماه) */
  safetyMonths: number;
  /** موجودی فعلی داروخانه */
  stock: number;
}

export interface QuickOfferEvaluation {
  id: string;
  title: string;
  buyQty: number;
  freeQty: number;
  totalQty: number;
  chequeMonths: number;
  bestPayMonth: number;
  /** درصد تخفیف کالایی صرف (فقط بونوس): Y ÷ (X + Y) */
  bonusDiscountRate: number;
  /** درصد تخفیف واقعی امروز با احتساب بونوس + مهلت چک + ارزش زمانی پول (و کسر واحدهای منقضی‌شده) */
  realDiscountRate: number;
  /** مبلغ کل پرداختی اسمی */
  nominalPaid: number;
  /** ارزش فعلی کل پرداختی به پول امروز */
  presentPaid: number;
  /** قیمت تمام‌شدهٔ اسمی هر واحد */
  nominalUnitCost: number;
  /** قیمت تمام‌شدهٔ واقعی هر واحد قابل فروش به ارزش پول امروز */
  presentUnitCost: number;
  /** ماه‌های لازم برای فروش کل بار (بر اساس مصرف ماهانه) */
  monthsToSell: number;
  /** آیا قبل از سررسید چک کل بار فروش می‌رود؟ */
  sellsBeforeCheque: boolean;
  /** تعداد قابل فروش تا تاریخ انقضا */
  sellableQty: number;
  /** تعداد در معرض انقضا */
  unsoldQty: number;
  /** آیا خطر انقضا دارد؟ */
  expiryRisky: boolean;
  /** ارزش فعلی کل پرداخت‌ها در سناریوی خرید عادی ماه‌به‌ماه (ریال) */
  baselinePresentPaid: number;
  /** مزیت ارزش فعلی کل این خرید نسبت به خرید عادی ماه‌به‌ماه (ریال) */
  totalAdvantage: number;
  /** مزیت ارزش فعلی به ازای هر واحد قابل فروش (ریال) */
  unitAdvantage: number;
}

/**
 * ارزیابی یک پیشنهاد در حالت مقایسهٔ سریع چند شرکت.
 * فرمول تخفیف واقعی امروز هر واحد (realDiscountRate):
 *   presentUnitCost = presentPaid / sellableQty
 *   realDiscountRate = 1 - (presentUnitCost / basePrice)
 *   (ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد)
 * فرمول مزیت نسبت به خرید عادی ماه‌به‌ماه (totalAdvantage):
 *   totalAdvantage = baselinePresentPaid - presentPaid
 */
export function evaluateQuickOffer(row: QuickOfferRow, ctx: QuickCompareContext): QuickOfferEvaluation {
  const basePrice = ctx.unitPrice > 0 ? ctx.unitPrice : 100_000;
  const itemPrice = row.priceOverride && row.priceOverride > 0 ? row.priceOverride : basePrice;
  const buyQty = Math.max(0, row.buyQty);
  const freeQty = Math.max(0, row.freeQty);
  const totalQty = buyQty + freeQty;
  const chequeMonths = Math.max(0, Math.round(row.chequeMonths));
  const discountPerMonth = Math.max(0, row.discountPerMonth || 0);

  // پیدا کردن بهترین ماه پرداخت (نقد با تخفیف زودپرداخت یا چک در سررسید)
  let bestPayMonth = chequeMonths;
  let nominalPaid = buyQty * itemPrice;
  let presentPaid = presentValue(nominalPaid, ctx.r, chequeMonths);

  for (let m = 0; m <= chequeMonths; m++) {
    const disc = earlyPayDiscount(discountPerMonth, chequeMonths, m);
    const paid = buyQty * itemPrice * (1 - disc);
    const pv = presentValue(paid, ctx.r, m);
    if (pv < presentPaid - 1e-6) {
      presentPaid = pv;
      nominalPaid = paid;
      bestPayMonth = m;
    }
  }

  const bonusDiscountRate = totalQty > 0 ? 1 - (buyQty * itemPrice) / (totalQty * basePrice) : 0;
  const nominalUnitCost = effectiveUnitCost(nominalPaid, buyQty, freeQty);

  const monthlyUse = Math.max(0, ctx.monthlyUse);
  const monthsToExpiry = ctx.monthsToExpiry > 0 ? ctx.monthsToExpiry : 18;
  const safetyMonths = ctx.safetyMonths >= 0 ? ctx.safetyMonths : 2;
  const stock = Math.max(0, ctx.stock || 0);

  const sellTime = monthlyUse > 0 ? (stock + totalQty) / monthlyUse : 0;
  const maxSellableBeforeExpiry = monthlyUse > 0 ? Math.max(0, monthlyUse * monthsToExpiry - stock) : totalQty;
  const sellableQty = monthlyUse > 0 ? Math.min(totalQty, maxSellableBeforeExpiry) : totalQty;
  const unsoldQty = Math.max(0, totalQty - sellableQty);
  const expiryRisky = monthlyUse > 0 && sellTime > Math.max(0, monthsToExpiry - safetyMonths);

  // قیمت تمام‌شدهٔ واقعی هر واحد قابل فروش به پول امروز (زمان فروش را در نظر نمی‌گیرد)
  const presentUnitCost = sellableQty > 0 ? presentPaid / sellableQty : Infinity;
  const realDiscountRate = sellableQty > 0 && basePrice > 0 ? 1 - presentUnitCost / basePrice : -1;

  // محاسبهٔ مزیت نسبت به سناریوی مبنای یکسان (خرید ماه‌به‌ماه به اندازهٔ مصرف ماهانه با چک عادی)
  let baselinePresentPaid = 0;
  if (monthlyUse > 0 && sellableQty > 0) {
    const syntheticInput: OfferInput = {
      price: itemPrice,
      consumerPrice: basePrice,
      qty: buyQty,
      everyX: buyQty > 0 ? buyQty : 1,
      freeY: freeQty,
      baseMonths: chequeMonths,
      discountPerMonth,
      stock,
      monthsToExpiry,
      safetyMonths,
      monthlyUse,
      r: ctx.r,
      mix: [],
      normalPrice: basePrice,
      normalMonths: Math.max(0, Math.round(ctx.normalMonths)),
      normalQty: monthlyUse,
    };
    baselinePresentPaid = present(normalPayments(syntheticInput, sellableQty), ctx.r);
  } else {
    baselinePresentPaid = presentValue(sellableQty * basePrice, ctx.r, Math.max(0, Math.round(ctx.normalMonths)));
  }

  const totalAdvantage = baselinePresentPaid - presentPaid;
  const unitAdvantage = sellableQty > 0 ? totalAdvantage / sellableQty : 0;

  return {
    id: row.id,
    title: row.title || 'پیشنهاد',
    buyQty,
    freeQty,
    totalQty,
    chequeMonths,
    bestPayMonth,
    bonusDiscountRate,
    realDiscountRate,
    nominalPaid,
    presentPaid,
    nominalUnitCost,
    presentUnitCost,
    monthsToSell: sellTime,
    sellsBeforeCheque: monthlyUse > 0 ? sellTime <= chequeMonths + 1e-6 : true,
    sellableQty,
    unsoldQty,
    expiryRisky,
    baselinePresentPaid,
    totalAdvantage,
    unitAdvantage,
  };
}

/**
 * مقایسهٔ چند پیشنهاد و تعیین برنده.
 * ترتیب رتبه‌بندی:
 * ۱. اولویت با پیشنهادهای بدون خطر انقضا (!expiryRisky)
 * ۲. بیشترین مزیت ارزش فعلی نسبت به خرید عادی ماه‌به‌ماه (totalAdvantage)
 * ۳. در صورت برابری، بیشترین تخفیف واقعی امروز هر واحد (realDiscountRate)
 * اگر totalAdvantage همهٔ پیشنهادها منفی یا صفر باشد، پرچم noneBeatsNormal: true برگردانده می‌شود.
 */
export function compareQuickOffers(rows: QuickOfferRow[], ctx: QuickCompareContext) {
  const valid = rows
    .filter((r) => r.buyQty > 0 && r.buyQty + r.freeQty > 0)
    .map((r) => evaluateQuickOffer(r, ctx));

  if (valid.length === 0) {
    return {
      evaluations: [] as QuickOfferEvaluation[],
      winner: null as QuickOfferEvaluation | null,
      runnerUp: null as QuickOfferEvaluation | null,
      noneBeatsNormal: false,
    };
  }

  const sorted = [...valid].sort((a, b) => {
    if (a.expiryRisky !== b.expiryRisky) return a.expiryRisky ? 1 : -1;
    if (Math.abs(b.totalAdvantage - a.totalAdvantage) > 1e-6) return b.totalAdvantage - a.totalAdvantage;
    return b.realDiscountRate - a.realDiscountRate;
  });

  const noneBeatsNormal = valid.every((e) => e.totalAdvantage <= 0);

  return {
    evaluations: valid,
    winner: sorted[0] ?? null,
    runnerUp: sorted[1] ?? null,
    noneBeatsNormal,
  };
}

