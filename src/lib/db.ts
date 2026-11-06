import Dexie, { type EntityTable } from 'dexie';
import type { ShareBase } from './calc';
import type { CashPolicy } from './cashflow';
import type { Unit } from './format';
import { currentMonthKey } from './jalali';
import { formFamily } from './drugname';
import { matchKey } from './text';

// مدل دادهٔ کل برنامه. مبلغ‌ها ریال، درصدها کسر (۳٪ = 0.03)، ماه‌ها شمسی «1405-08»، تاریخ‌ها میلادی «2026-11-06».
// sample=true یعنی ردیف «نمونه» است و با دکمهٔ پاک کردن داده‌های نمونه حذف می‌شود.

interface Base {
  id: number;
  sample?: boolean;
}

export type Theme = 'light' | 'dark';

export interface Settings {
  id: 'main';
  openingCash: number;
  monthlyRate: number;
  technicalFee: number;
  technicalFeeInsurerShare: number;
  startMonth: string;
  workDaysPerMonth: number;
  minSafeCash: number;
  /** میانگین درصد سود وقتی سود واقعی قلم در دسترس نیست */
  defaultMarginRate?: number;
  /** سیاست خرید صفحهٔ نقدینگی */
  cashPolicy?: Partial<CashPolicy>;
  displayUnit: Unit;
  theme: Theme;
  lastBackupAt?: string;
}

export interface Insurer extends Base {
  name: string;
  delayMonths: number;
  deductionRate: number;
  priceListId: number | null;
  defaultShare: number;
  active: boolean;
}

export interface PriceList extends Base {
  insurerId: number;
  fileName: string;
  effectiveDate: string;
  shareBase: ShareBase;
  importedAt: string;
}

export interface Drug extends Base {
  genericCode?: string;
  brandCode?: string;
  irc?: string;
  genericName: string;
  form?: string;
  dose?: string;
  price: number;
  otc: boolean;
  /** همهٔ کدهای این دارو در فهرست‌های مختلف */
  codes: string[];
  /** همهٔ نام‌های این دارو در فهرست‌های مختلف */
  names: string[];
  formFamily: string;
  /** متن نرمال‌شده برای جستجو */
  searchText: string;
  manual?: boolean;
  /** کاربر تأیید کرده این ردیف‌ها یک دارو هستند، حتی با قیمت‌های خیلی متفاوت */
  trustPrices?: boolean;
}

export interface DrugAlias extends Base {
  alias: string;
  drugId: number;
}

export interface Coverage extends Base {
  drugId: number;
  insurerId: number;
  /** شناسهٔ این ردیف در فهرست همان بیمه؛ ورود دوباره با همین کلید ردیف را پیدا می‌کند. */
  listKey: string;
  /** قیمت مصرف‌کننده در این فهرست */
  price: number;
  netPrice?: number;
  subsidy?: number;
  shareRate?: number;
  coveredPrice?: number;
  insurerAmount?: number;
  /** وقتی سهم بسته به شرایط چند مبلغ دارد؛ insurerAmount کمترین آن‌هاست */
  shareOptions?: number[];
  status?: string;
  conditions?: string;
  hospitalOnly?: boolean;
  caseBased?: boolean;
  prescribeLimit?: string;
  ePrescription?: string;
  inDocs?: string;
  webOnly?: string;
  minPrice?: number;
  lists?: string;
  effectiveDate?: string;
  /** برای سهم دستی: پایهٔ همین ردیف، به‌جای پایهٔ فهرست */
  shareBase?: ShareBase;
  /** در آخرین فهرست واردشده نبود */
  stale?: boolean;
}

export interface PriceHistory extends Base {
  drugId: number;
  insurerId?: number;
  oldPrice: number;
  newPrice: number;
  date: string;
  /** شناسهٔ نوبت ورود، برای گزارش «قیمتشان عوض شد» */
  batch: string;
}

/** تطبیق نامطمئن که باید کاربر تصمیم بگیرد */
export interface ReviewItem {
  id: number;
  drugId: number;
  candidateId: number;
  reason: string;
  status: 'open' | 'merged' | 'separate';
}

export interface Distributor extends Base {
  name: string;
  baseChequeMonths: number;
  earlyPayDiscountPerMonth: number;
}

export type PaymentType = 'cash' | 'cheque' | 'mixed' | 'credit';

export interface InvoicePayment {
  type: PaymentType;
  chequeMonths: number | null;
  dueDate: string | null;
  notes: string;
}

export interface Invoice extends Base {
  number: string;
  date: string;
  distributorId: number;
  payment: InvoicePayment;
  /** جمع قابل پرداخت (ریال) */
  payable: number;
  currencyNote?: string;
  warnings?: string[];
}

export interface InvoiceItem extends Base {
  invoiceId: number;
  /** تهی یعنی هنوز به داروی بانک وصل نشده است */
  drugId: number | null;
  name: string;
  irc?: string;
  genericCode?: string;
  form?: string;
  strength?: string;
  batch?: string;
  expiry?: string;
  quantity: number;
  bonus: number;
  unitPrice: number;
  consumerPrice: number;
  /** درصد تخفیف به شکل کسر */
  discount: number;
  discountAmount: number;
  /** مالیات کل سطر (ریال) */
  tax: number;
  /** جمع سطر بعد از تخفیف و با مالیات */
  total: number;
  effectiveUnitCost: number;
  marginOnSale: number;
  marginOnCost: number;
}

export interface InventoryLot extends Base {
  drugId: number | null;
  name: string;
  batch?: string;
  expiry?: string;
  remaining: number;
  source: string;
  invoiceId?: number;
}

export interface Cheque extends Base {
  distributorId: number;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid';
  invoiceId?: number;
  note?: string;
}

export interface Doctor extends Base {
  name: string;
  specialty: string;
  rxPerDay: number;
  workDays: number;
  startMonth: string;
  insurerMix: Record<number, number>;
  captureRate: number;
  officeRent: number;
  pharmacyRentShare: number;
  monthlyAllowance: number;
  active: boolean;
  /** روزهای کاری هفته؛ صفر یعنی شنبه */
  weekDays?: number[];
  shift?: 'morning' | 'evening' | 'both';
  /** میانگین مبلغ نسخه (تخمینی) */
  avgRxAmount?: number;
  /** فروش از میانگین مبلغ نسخه یا از پروفایل دارویی */
  salesBasis?: 'average' | 'profile';
}

export interface DoctorDrugProfile extends Base {
  doctorId: number;
  drugId: number;
  rxShare: number;
  qtyPerRx: number;
}

export interface FixedCost extends Base {
  title: string;
  amount: number;
  /** سهم داروخانه از این مبلغ؛ مثلاً اجارهٔ مطب ۵۰٪. خالی یعنی ۱۰۰٪ */
  pharmacyShare?: number;
  startMonth: string;
  endMonth?: string;
}

export interface OneOffCost extends Base {
  title: string;
  amount: number;
  month: string;
}

export interface Sale extends Base {
  date: string;
  rxNumber: string;
  doctorId?: number;
  insurerId?: number;
  drugId: number;
  quantity: number;
  total: number;
  insurerShare: number;
  patientShare: number;
  patientName?: string;
}

export interface InsuranceClaim extends Base {
  insurerId: number;
  month: string;
  submitted: number;
  deductions: number;
  expectedMonth: string;
  received: number;
}

/** نگاشت: هر فیلد برنامه به کدام شمارهٔ ستون فایل وصل است (از صفر). */
export interface ImportMapping {
  columns: Record<string, number>;
  moneyUnit: Unit;
}

/** قالب ذخیره‌شده؛ با امضای سرستون‌ها فایل مشابه را می‌شناسد. */
export interface ImportTemplate extends ImportMapping {
  signature: string;
  headerRow: number;
  /** برای فهرست تعهد: این فایل مال کدام بیمه است */
  insurerId?: number;
}

export interface ImportSlot {
  id: string;
  title: string;
  table: string;
  status: 'empty' | 'mapped' | 'imported';
  templates?: ImportTemplate[];
  lastImportAt?: string;
  lastRowCount?: number;
}

export interface Offer extends Base {
  title: string;
  createdAt: string;
  input: unknown;
  result: unknown;
}

class PharmacyDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  insurers!: EntityTable<Insurer, 'id'>;
  priceLists!: EntityTable<PriceList, 'id'>;
  drugs!: EntityTable<Drug, 'id'>;
  drugAliases!: EntityTable<DrugAlias, 'id'>;
  coverage!: EntityTable<Coverage, 'id'>;
  priceHistory!: EntityTable<PriceHistory, 'id'>;
  distributors!: EntityTable<Distributor, 'id'>;
  invoices!: EntityTable<Invoice, 'id'>;
  invoiceItems!: EntityTable<InvoiceItem, 'id'>;
  inventoryLots!: EntityTable<InventoryLot, 'id'>;
  cheques!: EntityTable<Cheque, 'id'>;
  doctors!: EntityTable<Doctor, 'id'>;
  doctorDrugProfile!: EntityTable<DoctorDrugProfile, 'id'>;
  fixedCosts!: EntityTable<FixedCost, 'id'>;
  oneOffCosts!: EntityTable<OneOffCost, 'id'>;
  sales!: EntityTable<Sale, 'id'>;
  insuranceClaims!: EntityTable<InsuranceClaim, 'id'>;
  importSlots!: EntityTable<ImportSlot, 'id'>;
  offers!: EntityTable<Offer, 'id'>;
  reviewItems!: EntityTable<ReviewItem, 'id'>;

  constructor() {
    super('pharmacy-finance');
    this.version(1).stores({
      settings: 'id',
      insurers: '++id, name',
      priceLists: '++id, insurerId',
      drugs: '++id, genericCode, brandCode, irc, genericName',
      drugAliases: '++id, alias, drugId',
      coverage: '++id, [drugId+insurerId], insurerId',
      priceHistory: '++id, drugId, date',
      distributors: '++id, name',
      invoices: '++id, number, date, distributorId',
      invoiceItems: '++id, invoiceId, drugId',
      inventoryLots: '++id, drugId, expiry',
      cheques: '++id, dueDate, status, distributorId, invoiceId',
      doctors: '++id, name',
      doctorDrugProfile: '++id, doctorId, drugId',
      fixedCosts: '++id, title',
      oneOffCosts: '++id, month',
      sales: '++id, date, rxNumber, doctorId, insurerId, drugId',
      insuranceClaims: '++id, insurerId, month',
      importSlots: 'id',
      offers: '++id, createdAt',
    });
    // مرحلهٔ ۲: کدهای چندگانهٔ دارو، کلید ردیف فهرست، و فهرست «نیاز به بررسی»
    this.version(2)
      .stores({
        drugs: '++id, *codes, genericCode, brandCode, irc, genericName',
        coverage: '++id, [drugId+insurerId], insurerId, drugId, listKey',
        priceHistory: '++id, drugId, date, batch',
        reviewItems: '++id, status, drugId, candidateId',
      })
      .upgrade(async (tx) => {
        await tx.table('drugs').toCollection().modify((drug) => Object.assign(drug, completeDrug(drug)));
        await tx.table('importSlots').toCollection().modify((slot) => {
          delete slot.mapping;
        });
      });
    // مرحلهٔ ۳: پیوند بچ‌ها با فاکتور
    this.version(3).stores({ inventoryLots: '++id, drugId, expiry, invoiceId' });
  }
}

export const db = new PharmacyDB();

export const SCHEMA_VERSION = 3;

/** فیلدهای جانبی دارو را از روی نام و کدها می‌سازد. */
export function completeDrug<T extends Partial<Drug> & { genericName: string }>(drug: T) {
  const names = drug.names?.length ? drug.names : [drug.genericName];
  const codes = drug.codes ?? [drug.genericCode, drug.brandCode, drug.irc].filter((c): c is string => Boolean(c));
  const parts = [...names, ...codes, drug.form, drug.dose];
  return {
    ...drug,
    names,
    codes,
    formFamily: formFamily(`${drug.form ?? ''} ${names.join(' ')}`),
    searchText: matchKey(parts.filter(Boolean).join(' ')),
  };
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  openingCash: 0,
  monthlyRate: 0.03,
  technicalFee: 0,
  technicalFeeInsurerShare: 0,
  startMonth: currentMonthKey(),
  workDaysPerMonth: 26,
  minSafeCash: 0,
  defaultMarginRate: 0.18,
  displayUnit: 'toman',
  theme: 'light',
};

export const newInsurer = (name: string): Omit<Insurer, 'id'> => ({
  name,
  delayMonths: 6,
  deductionRate: 0,
  priceListId: null,
  defaultShare: 0.7,
  active: true,
});

const DEFAULT_INSURERS = ['تأمین اجتماعی', 'سلامت', 'نیروهای مسلح'];

/** اولین باز شدن برنامه: تنظیمات و بیمه‌های اصلی را می‌سازد. دفعه‌های بعد کاری نمی‌کند. */
export async function ensureDefaults(): Promise<void> {
  await db.transaction('rw', db.settings, db.insurers, async () => {
    if (await db.settings.get('main')) return;
    await db.settings.put(DEFAULT_SETTINGS);
    if ((await db.insurers.count()) === 0) {
      await db.insurers.bulkAdd(DEFAULT_INSURERS.map(newInsurer) as Insurer[]);
    }
  });
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await db.settings.update('main', patch);
}
