// همهٔ محاسبات مالی برنامه اینجاست: توابع خالص، بدون وابستگی به صفحه یا پایگاه داده.
// قرارداد: مبلغ‌ها به ریال، درصدها به شکل کسر (۳٪ = 0.03)، زمان به ماه.

// ---------- ارزش زمانی پول ----------

/** ارزش امروزِ پولِ ماه t. فرمول: مبلغ ÷ (1+r)^t — ماه صفر یعنی امروز. */
export function presentValue(amount: number, r: number, t: number): number {
  return amount / Math.pow(1 + r, t);
}

// ---------- خرید از شرکت پخش ----------

/** تعداد بونوس. فرمول: floor(Q ÷ X) × Y — مثال: آفر ۱۰+۲ و خرید ۲۵ عدد ← ۴ عدد بونوس. */
export function bonusUnits(quantity: number, everyX: number, freeY: number): number {
  if (everyX <= 0) return 0;
  return Math.floor(quantity / everyX) * freeY;
}

/**
 * درصد تخفیف زودپرداخت. فرمول: d × (M − m)
 * M مدت چک پایه، m ماه پرداخت (صفر یعنی نقد)، d تخفیف هر ماه.
 * مثال: چک ۶ ماهه با ۲٪ در ماه، پرداخت نقد ← ۱۲٪. پرداخت بعد از M تخفیفی ندارد.
 */
export function earlyPayDiscount(d: number, baseMonths: number, payMonth: number): number {
  return d * Math.max(0, baseMonths - payMonth);
}

/**
 * مبلغ واقعاً پرداختی فاکتور. تخفیف روی مبلغ فاکتور اعمال می‌شود، سپس مالیات روی مبلغ بعد از تخفیف.
 * فرمول: فاکتور × (1 − تخفیف) × (1 + مالیات)
 */
export function netPaid(invoiceAmount: number, discount: number, taxRate = 0): number {
  return invoiceAmount * (1 - discount) * (1 + taxRate);
}

/** قیمت تمام‌شدهٔ مؤثر هر واحد. فرمول: مبلغ پرداختی ÷ (تعداد خرید + تعداد بونوس) */
export function effectiveUnitCost(paid: number, quantity: number, bonus: number): number {
  const units = quantity + bonus;
  return units > 0 ? paid / units : 0;
}

/** درصد سود روی فروش. فرمول: (C − قیمت تمام‌شده) ÷ C */
export function marginOnSale(price: number, unitCost: number): number {
  return price > 0 ? (price - unitCost) / price : 0;
}

/** درصد سود روی خرید. فرمول: (C − قیمت تمام‌شده) ÷ قیمت تمام‌شده */
export function marginOnCost(price: number, unitCost: number): number {
  return unitCost > 0 ? (price - unitCost) / unitCost : 0;
}

export interface LineInput {
  qty: number;
  bonus: number;
  unitPrice: number;
  /** درصد تخفیف به شکل کسر؛ اگر مبلغ تخفیف داده شده باشد، مبلغ مقدم است */
  discountPercent: number;
  discountAmount: number;
  /** مالیات کل سطر */
  tax: number;
  consumerPrice: number;
}

/**
 * محاسبات یک سطر فاکتور:
 * جمع سطر بعد از تخفیف + مالیات = مبلغ پرداختی
 * قیمت تمام‌شدهٔ مؤثر = مبلغ پرداختی ÷ (تعداد + بونوس)
 * سود هر واحد = قیمت مصرف‌کننده − قیمت تمام‌شده؛ سود کل قلم = سود هر واحد × (تعداد + بونوس)
 */
export function lineFigures(line: LineInput) {
  const gross = line.qty * line.unitPrice;
  const discount = line.discountAmount > 0 ? line.discountAmount : gross * line.discountPercent;
  const net = gross - discount;
  const paid = net + line.tax;
  const units = line.qty + line.bonus;
  const unitCost = effectiveUnitCost(paid, line.qty, line.bonus);
  const unitProfit = line.consumerPrice - unitCost;
  return {
    gross,
    discount,
    net,
    paid,
    units,
    unitCost,
    unitProfit,
    totalProfit: unitProfit * units,
    marginOnSale: marginOnSale(line.consumerPrice, unitCost),
    marginOnCost: marginOnCost(line.consumerPrice, unitCost),
  };
}

/**
 * سود هر واحد با احتساب تأخیر بیمه:
 * اسمی = سهم بیمار + سهم بیمه × (1 − کسورات) − قیمت تمام‌شده
 * واقعی = سهم بیمار (الان نقد) + سهم بیمه × (1 − کسورات) ÷ (1+r)^L − قیمت تمام‌شده
 */
export function realProfit(input: {
  patient: number;
  insurer: number;
  deductionRate: number;
  delayMonths: number;
  r: number;
  unitCost: number;
}) {
  const collected = input.insurer * (1 - input.deductionRate);
  const today = presentValue(collected, input.r, input.delayMonths);
  return {
    collected,
    today,
    nominal: input.patient + collected - input.unitCost,
    real: input.patient + today - input.unitCost,
  };
}

/** توزیع درصد سود روی فروش در بازه‌های ۵ درصدی؛ زیان یک بازه و ۴۰٪ به بالا یک بازه. */
export function marginHistogram(margins: number[]): { label: string; count: number }[] {
  const bins = [{ label: 'زیان', count: 0 }];
  for (let from = 0; from < 40; from += 5) {
    bins.push({ label: `${from.toLocaleString('fa-IR')}–${(from + 5).toLocaleString('fa-IR')}`, count: 0 });
  }
  bins.push({ label: `${(40).toLocaleString('fa-IR')}+`, count: 0 });
  for (const m of margins) {
    if (m < 0) bins[0].count++;
    else bins[Math.min(Math.floor((m * 100 + 1e-9) / 5), 8) + 1].count++;
  }
  return bins;
}

// ---------- سهم بیمه و بیمار ----------

/** سهم سازمان. اگر فایل بیمه مبلغ را مستقیم داده همان، وگرنه: درصد سهم × پایهٔ تعهد */
export function insurerShare(input: { direct?: number | null; rate?: number; base?: number }): number {
  if (input.direct !== null && input.direct !== undefined) return input.direct;
  return (input.rate ?? 0) * (input.base ?? 0);
}

/** سهم بیمار. فرمول: C − سهم سازمان */
export function patientShare(price: number, insurer: number): number {
  return price - insurer;
}

/**
 * پایهٔ محاسبهٔ سهم وقتی فهرست بیمه مبلغ سهم را مستقیم نداده است:
 * price: درصد × قیمت
 * coveredPrice: درصد × قیمت مورد تعهد (جمع مورد قبول)
 * netOfSubsidy: درصد × (قیمت − یارانه)
 * netPlusSubsidy: درصد × (قیمت − یارانه) + یارانه — همان الگوی فهرست بیمه سلامت
 */
export type ShareBase = 'price' | 'coveredPrice' | 'netOfSubsidy' | 'netPlusSubsidy';

export interface CoverageInput {
  price: number;
  shareBase: ShareBase;
  coveredPrice?: number;
  subsidy?: number;
  shareRate?: number;
  insurerAmount?: number | null;
  notCovered?: boolean;
}

/** سهم سازمان و سهم بیمار یک دارو در یک بیمه. مبلغ مستقیم فایل همیشه مقدم است. */
export function coverageShares(input: CoverageInput): { insurer: number; patient: number } {
  const { price, shareBase, shareRate = 0, subsidy = 0 } = input;
  if (input.notCovered) return { insurer: 0, patient: price };
  let insurer: number;
  if (shareBase === 'netPlusSubsidy' && (input.insurerAmount === null || input.insurerAmount === undefined)) {
    insurer = shareRate * (price - subsidy) + subsidy;
  } else {
    const base =
      shareBase === 'coveredPrice' ? (input.coveredPrice ?? price)
      : shareBase === 'netOfSubsidy' ? price - subsidy
      : price;
    insurer = insurerShare({ direct: input.insurerAmount, rate: shareRate, base });
  }
  return { insurer, patient: patientShare(price, insurer) };
}

// ---------- پزشکان و پیش‌بینی ----------

/** نسخهٔ ماهانهٔ پزشک = نسخه در روز × روز کاری ماه × درصد پیچیده‌شده در این داروخانه */
export function monthlyRx(rxPerDay: number, workDays: number, captureRate: number): number {
  return rxPerDay * workDays * captureRate;
}

/** مصرف ماهانهٔ یک دارو از نسخه‌های یک پزشک = نسخهٔ ماهانه × درصد نسخه‌های حاوی دارو × تعداد در نسخه */
export function drugMonthlyUse(rx: number, rxShare: number, qtyPerRx: number): number {
  return rx * rxShare * qtyPerRx;
}

/** سود خالص پزشک = سود ناخالص − سهم داروخانه از اجارهٔ مطب − کمک‌هزینه */
export function doctorNet(input: { gross: number; officeRent: number; rentShare: number; allowance: number }) {
  const rent = input.officeRent * input.rentShare;
  return { rent, net: input.gross - rent - input.allowance };
}

/** میانگین متحرک ۳ ماهه: میانگین سه مقدار آخر (یا کمتر، اگر هنوز سه ماه نشده). */
export function movingAverage3(values: number[]): number {
  return average(values.slice(-3));
}

/** درصد خطای تخمین نسبت به واقعی */
export function forecastError(estimate: number, actual: number): number {
  return actual > 0 ? Math.abs(estimate - actual) / actual : 0;
}

// ---------- چک‌ها و وضعیت نقدینگی ----------

export interface ChequeLike {
  amount: number;
  dueDate: string; // میلادی به شکل 2026-11-06
  status: string;
}

/** چک‌های پرداخت‌نشده‌ای که سررسیدشان تا تاریخ until است (چک‌های عقب‌افتاده هم حساب می‌شوند). */
export function dueCheques<T extends ChequeLike>(cheques: T[], until: string): { items: T[]; total: number } {
  const items = cheques
    .filter((c) => c.status === 'pending' && c.dueDate <= until)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { items, total: items.reduce((sum, c) => sum + c.amount, 0) };
}

export type CashStatus = 'safe' | 'warn' | 'short';

/** وضعیت موجودی: منفی ← کسری؛ کمتر از حداقل امن ← هشدار؛ وگرنه امن. */
export function cashStatus(balance: number, minSafe: number): CashStatus {
  if (balance < 0) return 'short';
  return balance < minSafe ? 'warn' : 'safe';
}

/** میانگین ساده */
export function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
