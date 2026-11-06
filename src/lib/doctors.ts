import { average, doctorNet, drugMonthlyUse, monthlyRx, movingAverage3 } from './calc';
import type {
  Coverage, Distributor, Doctor, DoctorDrugProfile, Drug, Insurer, Invoice, InvoiceItem, PriceList, Sale, Settings,
} from './db';
import { insurerColumn } from './drugbank';
import { latestPurchases } from './invoice';
import { jalaliParts, monthKey } from './jalali';

// پیش‌بینی فروش و سود هر پزشک. همه‌چیز خالص است و از روی آرایه‌ها حساب می‌شود، پس سناریو چیزی ذخیره نمی‌کند.

/** کلید «آزاد» در ترکیب بیمه: بیمارانی که بیمه ندارند. */
export const FREE_KEY = 0;

export const DEFAULT_CAPTURE = 0.7;
export const DEFAULT_MARGIN = 0.18;

export const WEEK_DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export const SHIFT_LABEL = { morning: 'صبح', evening: 'عصر', both: 'صبح و عصر' } as const;

/** روز کاری ماه از روزهای هفته: میانگین ماه ۴٫۳ هفته است. */
export const workDaysFromWeek = (days: number[]) => Math.round(days.length * 4.33);

export const newDoctor = (month: string): Omit<Doctor, 'id'> => ({
  name: '', specialty: '', rxPerDay: 0, workDays: 26, startMonth: month, insurerMix: { [FREE_KEY]: 1 },
  captureRate: DEFAULT_CAPTURE, officeRent: 0, pharmacyRentShare: 0, monthlyAllowance: 0, active: true,
  weekDays: [0, 1, 2, 3, 4, 5], shift: 'both', avgRxAmount: 0,
});

/** جمع ترکیب بیمه باید ۱۰۰٪ باشد. پیام خطا یا تهی. */
export function mixProblem(mix: Record<number, number>): string | null {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) < 0.0001) return null;
  return `جمع ترکیب بیمه باید ۱۰۰٪ باشد؛ الان ${(total * 100).toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪ است.`;
}

export interface ForecastContext {
  drugs: Map<number, Drug>;
  coverage: Map<string, Coverage>;
  insurers: Map<number, Insurer>;
  lists: Map<number, PriceList>;
  /** درصد سود روی فروش آخرین خرید هر دارو */
  margins: Map<number, number>;
  defaultMargin: number;
  sales: Sale[];
}

export function buildContext(data: {
  drugs: Drug[];
  coverage: Coverage[];
  insurers: Insurer[];
  lists: PriceList[];
  items: InvoiceItem[];
  invoices: Invoice[];
  distributors: Distributor[];
  sales: Sale[];
  settings: Settings;
}): ForecastContext {
  const margins = new Map<number, number>();
  for (const row of latestPurchases(data.items, data.invoices, data.distributors)) {
    if (row.item.drugId !== null) margins.set(row.item.drugId, row.item.marginOnSale);
  }
  return {
    drugs: new Map(data.drugs.map((d) => [d.id, d])),
    coverage: new Map(data.coverage.map((c) => [`${c.drugId}|${c.insurerId}`, c])),
    insurers: new Map(data.insurers.map((i) => [i.id, i])),
    lists: new Map(data.lists.map((l) => [l.id, l])),
    margins,
    defaultMargin: data.settings.defaultMarginRate ?? DEFAULT_MARGIN,
    sales: data.sales,
  };
}

export type Source = 'manual' | 'actual';

export const SOURCE_LABEL: Record<Source, string> = { manual: 'تخمین دستی', actual: 'واقعی (داروپردازان)' };

export interface MixRow {
  key: number;
  name: string;
  share: number;
  sales: number;
  insurer: number;
  patient: number;
}

export interface ProfileRow {
  profile: Pick<DoctorDrugProfile, 'drugId' | 'rxShare' | 'qtyPerRx'> & { id?: number };
  drug?: Drug;
  use: number;
  sales: number;
  margin: number;
  marginFromPurchase: boolean;
}

export interface DoctorForecast {
  doctor: Omit<Doctor, 'id'> & { id?: number };
  rx: number;
  sales: number;
  insurer: number;
  patient: number;
  byInsurer: MixRow[];
  gross: number;
  margin: number;
  rent: number;
  allowance: number;
  net: number;
  basis: 'average' | 'profile' | 'none';
  averageSales: number;
  profileSales: number;
  source: Source;
  rows: ProfileRow[];
}

const monthOf = (iso: string) => {
  const { y, m } = jalaliParts(iso);
  return monthKey(y, m);
};

/** فروش واقعی یک پزشک به تفکیک ماه؛ میانگین متحرک ۳ ماه آخر جای تخمین را می‌گیرد. */
function actualFigures(sales: Sale[]) {
  if (sales.length === 0) return null;
  const months = new Map<string, { rx: Set<string>; total: number; insurer: number }>();
  for (const sale of sales) {
    const key = monthOf(sale.date);
    const month = months.get(key) ?? { rx: new Set(), total: 0, insurer: 0 };
    month.rx.add(sale.rxNumber);
    month.total += sale.total;
    month.insurer += sale.insurerShare;
    months.set(key, month);
  }
  const list = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  return {
    rx: movingAverage3(list.map((m) => m.rx.size)),
    sales: movingAverage3(list.map((m) => m.total)),
    insurer: movingAverage3(list.map((m) => m.insurer)),
  };
}

export function forecastDoctor(
  doctor: DoctorForecast['doctor'],
  profile: ProfileRow['profile'][],
  ctx: ForecastContext,
): DoctorForecast {
  const estimatedRx = monthlyRx(doctor.rxPerDay, doctor.workDays, doctor.captureRate);
  const actual = doctor.id ? actualFigures(ctx.sales.filter((s) => s.doctorId === doctor.id)) : null;
  const rx = actual?.rx ?? estimatedRx;
  const mix = Object.entries(doctor.insurerMix).map(([key, share]) => ({ key: Number(key), share }));
  const nameOf = (key: number) => (key === FREE_KEY ? 'آزاد' : (ctx.insurers.get(key)?.name ?? 'بیمهٔ حذف‌شده'));

  // روش پروفایل: هر دارو با قیمت و سهم بیمهٔ بانک دارو
  let profileSales = 0;
  let profileInsurer = 0;
  let profileGross = 0;
  const byInsurerProfile = new Map<number, { sales: number; insurer: number }>();
  const rows: ProfileRow[] = profile.map((line) => {
    const drug = ctx.drugs.get(line.drugId);
    const use = drugMonthlyUse(rx, line.rxShare, line.qtyPerRx);
    const purchased = ctx.margins.get(line.drugId);
    const margin = purchased ?? ctx.defaultMargin;
    let sales = 0;
    if (drug) {
      for (const { key, share } of mix) {
        const insurer = ctx.insurers.get(key);
        const column =
          key !== FREE_KEY && insurer
            ? insurerColumn(
                drug,
                insurer,
                ctx.coverage.get(`${drug.id}|${key}`),
                insurer.priceListId ? ctx.lists.get(insurer.priceListId) : undefined,
              )
            : { price: drug.price, share: 0 };
        const units = use * share;
        const part = byInsurerProfile.get(key) ?? { sales: 0, insurer: 0 };
        part.sales += units * column.price;
        part.insurer += units * column.share;
        byInsurerProfile.set(key, part);
        sales += units * column.price;
        profileInsurer += units * column.share;
      }
    }
    profileSales += sales;
    profileGross += sales * margin;
    return { profile: line, drug, use, sales, margin, marginFromPurchase: purchased !== undefined };
  });

  const averageSales = rx * (doctor.avgRxAmount ?? 0);
  const hasProfile = rows.length > 0 && profileSales > 0;
  const wanted = doctor.salesBasis ?? (averageSales > 0 ? 'average' : 'profile');
  const basis: DoctorForecast['basis'] =
    wanted === 'profile' && hasProfile ? 'profile'
    : averageSales > 0 ? 'average'
    : hasProfile ? 'profile'
    : 'none';

  let sales: number;
  let insurer: number;
  let gross: number;
  let byInsurer: MixRow[];
  if (basis === 'profile') {
    sales = profileSales;
    insurer = profileInsurer;
    gross = profileGross;
    byInsurer = mix.map(({ key, share }) => {
      const part = byInsurerProfile.get(key) ?? { sales: 0, insurer: 0 };
      return { key, name: nameOf(key), share, sales: part.sales, insurer: part.insurer, patient: part.sales - part.insurer };
    });
  } else {
    // میانگین مبلغ نسخه: سهم هر بیمه با درصد سهم پیش‌فرض همان بیمه
    sales = averageSales;
    byInsurer = mix.map(({ key, share }) => {
      const part = sales * share;
      const rate = key === FREE_KEY ? 0 : (ctx.insurers.get(key)?.defaultShare ?? 0);
      return { key, name: nameOf(key), share, sales: part, insurer: part * rate, patient: part * (1 - rate) };
    });
    insurer = byInsurer.reduce((sum, row) => sum + row.insurer, 0);
    gross = sales * ctx.defaultMargin;
  }

  let source: Source = 'manual';
  if (actual) {
    const ratio = sales > 0 ? gross / sales : ctx.defaultMargin;
    const scale = sales > 0 ? actual.sales / sales : 0;
    byInsurer = byInsurer.map((r) => ({
      ...r, sales: r.sales * scale, insurer: r.insurer * scale, patient: r.patient * scale,
    }));
    sales = actual.sales;
    insurer = actual.insurer;
    gross = sales * ratio;
    source = 'actual';
  }

  const { rent, net } = doctorNet({
    gross,
    officeRent: doctor.officeRent,
    rentShare: doctor.pharmacyRentShare,
    allowance: doctor.monthlyAllowance,
  });
  return {
    doctor, rx, sales, insurer, patient: sales - insurer, byInsurer, gross,
    margin: sales > 0 ? gross / sales : ctx.defaultMargin,
    rent, allowance: doctor.monthlyAllowance, net, basis, averageSales, profileSales, source, rows,
  };
}

export interface DrugUse {
  drug: Drug;
  use: number;
  doctors: { name: string; use: number }[];
  source: Source;
}

/** مصرف ماهانهٔ هر دارو = جمع پزشکان فعال. فروش واقعی دارو با میانگین متحرک ۳ ماهه جایگزین تخمین می‌شود. */
export function drugConsumption(forecasts: DoctorForecast[], ctx: ForecastContext): DrugUse[] {
  const map = new Map<number, DrugUse>();
  for (const forecast of forecasts) {
    for (const row of forecast.rows) {
      if (!row.drug) continue;
      const entry = map.get(row.drug.id) ?? { drug: row.drug, use: 0, doctors: [], source: 'manual' as Source };
      entry.use += row.use;
      entry.doctors.push({ name: forecast.doctor.name, use: row.use });
      map.set(row.drug.id, entry);
    }
  }
  const actual = new Map<number, Map<string, number>>();
  for (const sale of ctx.sales) {
    const months = actual.get(sale.drugId) ?? new Map<string, number>();
    const key = monthOf(sale.date);
    months.set(key, (months.get(key) ?? 0) + sale.quantity);
    actual.set(sale.drugId, months);
  }
  for (const [drugId, months] of actual) {
    const drug = ctx.drugs.get(drugId);
    if (!drug) continue;
    const list = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    const entry = map.get(drugId) ?? { drug, use: 0, doctors: [], source: 'actual' as Source };
    entry.use = movingAverage3(list);
    entry.source = 'actual';
    map.set(drugId, entry);
  }
  return [...map.values()].sort((a, b) => b.use - a.use);
}

export function totalsOf(forecasts: DoctorForecast[]) {
  const sum = (pick: (f: DoctorForecast) => number) => forecasts.reduce((s, f) => s + pick(f), 0);
  return {
    rx: sum((f) => f.rx),
    sales: sum((f) => f.sales),
    insurer: sum((f) => f.insurer),
    gross: sum((f) => f.gross),
    net: sum((f) => f.net),
    margin: average(forecasts.map((f) => f.margin)),
  };
}
