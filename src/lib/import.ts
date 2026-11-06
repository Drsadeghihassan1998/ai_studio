import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { db, newInsurer, type ImportMapping, type ImportSlot, type ImportTemplate } from './db';
import { currentMonthKey, parseMonth } from './jalali';
import { toRial, type Unit } from './format';
import { matchKey, normalizeText, parseNumber, parsePercent } from './text';

XLSX.set_cptable(cptable);

// مرکز ورود داده: خواندن فایل، پیدا کردن سرستون، نگاشت ستون‌ها و نوشتن در جدول مقصد.

export type FieldType = 'text' | 'money' | 'percent' | 'number' | 'month';

export interface ImportField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** نام‌هایی که این ستون معمولاً در فایل‌ها دارد */
  aliases: string[];
}

export interface SlotDef {
  id: string;
  title: string;
  hint: string;
  table: string;
  /** این ورود از کدام مرحله فعال است؛ تا آن موقع فقط قالب نگاشت ذخیره می‌شود. */
  stage: number;
  fields: ImportField[];
  /** ردیف تکراری با این فیلد شناخته می‌شود و به‌جای افزودن، به‌روز می‌شود. */
  keyField?: string;
}

const CURRENT_STAGE = 2;

export const SLOT_DEFS: SlotDef[] = [
  {
    id: 'insurers', title: 'بیمه‌ها', hint: 'نام بیمه، تأخیر، کسورات و سهم پیش‌فرض', table: 'insurers', stage: 1, keyField: 'name',
    fields: [
      { key: 'name', label: 'نام بیمه', type: 'text', required: true, aliases: ['نام بیمه', 'بیمه', 'نام', 'سازمان'] },
      { key: 'delayMonths', label: 'تأخیر (ماه)', type: 'number', aliases: ['تاخیر', 'تأخیر', 'تاخیر ماه', 'مدت وصول'] },
      { key: 'deductionRate', label: 'کسورات', type: 'percent', aliases: ['کسورات', 'درصد کسورات', 'کسور'] },
      { key: 'defaultShare', label: 'سهم پیش‌فرض', type: 'percent', aliases: ['سهم', 'درصد سهم', 'سهم پیش فرض'] },
    ],
  },
  {
    id: 'distributors', title: 'شرکت‌های پخش', hint: 'نام شرکت، مدت چک و تخفیف زودپرداخت', table: 'distributors', stage: 1, keyField: 'name',
    fields: [
      { key: 'name', label: 'نام شرکت', type: 'text', required: true, aliases: ['نام شرکت', 'شرکت', 'نام', 'شرکت پخش'] },
      { key: 'baseChequeMonths', label: 'مدت چک پایه (ماه)', type: 'number', aliases: ['مدت چک', 'چک', 'مدت چک پایه'] },
      { key: 'earlyPayDiscountPerMonth', label: 'تخفیف زودپرداخت در ماه', type: 'percent', aliases: ['تخفیف', 'تخفیف زودپرداخت', 'تخفیف ماهانه'] },
    ],
  },
  {
    id: 'doctors', title: 'پزشکان', hint: 'نام، تخصص، نسخه در روز، اجاره و کمک‌هزینه', table: 'doctors', stage: 1, keyField: 'name',
    fields: [
      { key: 'name', label: 'نام پزشک', type: 'text', required: true, aliases: ['نام پزشک', 'پزشک', 'نام', 'دکتر'] },
      { key: 'specialty', label: 'تخصص', type: 'text', aliases: ['تخصص', 'رشته'] },
      { key: 'rxPerDay', label: 'نسخه در روز', type: 'number', aliases: ['نسخه در روز', 'نسخه روزانه', 'تعداد نسخه'] },
      { key: 'officeRent', label: 'اجارهٔ مطب', type: 'money', aliases: ['اجاره', 'اجاره مطب'] },
      { key: 'pharmacyRentShare', label: 'سهم داروخانه از اجاره', type: 'percent', aliases: ['سهم داروخانه', 'سهم اجاره', 'سهم داروخانه از اجاره'] },
      { key: 'monthlyAllowance', label: 'کمک‌هزینهٔ ماهانه', type: 'money', aliases: ['کمک هزینه', 'کمک هزینه ماهانه'] },
    ],
  },
  {
    id: 'fixedCosts', title: 'هزینه‌های ثابت', hint: 'عنوان، مبلغ ماهانه، ماه شروع و پایان', table: 'fixedCosts', stage: 1, keyField: 'title',
    fields: [
      { key: 'title', label: 'عنوان', type: 'text', required: true, aliases: ['عنوان', 'شرح', 'هزینه', 'نام'] },
      { key: 'amount', label: 'مبلغ ماهانه', type: 'money', required: true, aliases: ['مبلغ', 'مبلغ ماهانه', 'هزینه ماهانه'] },
      { key: 'startMonth', label: 'ماه شروع', type: 'month', aliases: ['ماه شروع', 'شروع', 'از ماه'] },
      { key: 'endMonth', label: 'ماه پایان', type: 'month', aliases: ['ماه پایان', 'پایان', 'تا ماه'] },
    ],
  },
  {
    id: 'drugs', title: 'بانک دارو', hint: 'کدها، نام ژنریک، شکل، دوز و قیمت مصرف‌کننده', table: 'drugs', stage: 2,
    fields: [
      { key: 'genericCode', label: 'کد ژنریک', type: 'text', aliases: ['کد ژنریک', 'ژنریک کد'] },
      { key: 'brandCode', label: 'کد برند', type: 'text', aliases: ['کد برند', 'کد', 'irc'] },
      { key: 'name', label: 'نام دارو', type: 'text', required: true, aliases: ['نام ژنریک', 'نام دارو', 'نام', 'شرح'] },
      { key: 'form', label: 'شکل', type: 'text', aliases: ['شکل', 'شکل دارویی'] },
      { key: 'dose', label: 'دوز', type: 'text', aliases: ['دوز', 'قدرت'] },
      { key: 'price', label: 'قیمت مصرف‌کننده', type: 'money', required: true, aliases: ['قیمت', 'قیمت مصرف کننده', 'قیمت مصرف'] },
    ],
  },
  {
    id: 'coverage', title: 'فهرست تعهد بیمه', hint: 'فایل تعهد هر بیمه؛ فایل سلامت و فارماکوپهٔ تأمین خودکار شناخته می‌شوند', table: 'coverage', stage: 2,
    fields: [
      { key: 'name', label: 'نام دارو', type: 'text', required: true, aliases: ['نام دارو', 'عنوان', 'نام', 'شرح'] },
      { key: 'brandCode', label: 'کد برند / کد دارو', type: 'text', aliases: ['کد برند', 'کد دارو', 'کد', 'irc'] },
      { key: 'genericCode', label: 'کد ژنریک', type: 'text', aliases: ['کد ژنریک'] },
      { key: 'form', label: 'شکل', type: 'text', aliases: ['شکل', 'شکل دارویی'] },
      { key: 'dose', label: 'دوز', type: 'text', aliases: ['دوز', 'قدرت'] },
      { key: 'price', label: 'قیمت مصرف‌کننده', type: 'money', aliases: ['قیمت مصرف کننده', 'قیمت کل مورد درتعهد', 'قیمت'] },
      { key: 'netPrice', label: 'قیمت بدون یارانه', type: 'money', aliases: ['قیمت بدون یارانه'] },
      { key: 'subsidy', label: 'یارانه', type: 'money', aliases: ['یارانه', 'یارانه دولت', 'یارانه ارزی'] },
      { key: 'shareRate', label: 'درصد سهم سازمان', type: 'percent', aliases: ['درصد سهم سازمان', 'درصد سهم', 'درصد سازمان'] },
      { key: 'insurerAmount', label: 'مبلغ سهم سازمان', type: 'money', aliases: ['مبلغ سهم سازمان'] },
      { key: 'coveredPrice', label: 'قیمت مورد تعهد / جمع مورد قبول', type: 'money', aliases: ['جمع مورد قبول', 'قیمت مورد تعهد', 'مورد قبول'] },
      { key: 'nominalRate', label: 'سهم پایهٔ سازمان', type: 'text', aliases: ['سهم سازمان'] },
      { key: 'status', label: 'وضعیت تعهد', type: 'text', aliases: ['وضعیت تعهد', 'وضعیت', 'تعهد'] },
      { key: 'conditions', label: 'شرایط تعهد', type: 'text', aliases: ['شرایط تعهد', 'شرایط'] },
      { key: 'hospital', label: 'بیمارستانی', type: 'text', aliases: ['بیمارستانی'] },
      { key: 'caseBased', label: 'پرونده‌ای', type: 'text', aliases: ['پرونده ای', 'پرونده‌ای'] },
      { key: 'prescribeLimit', label: 'سقف تجویز', type: 'text', aliases: ['سقف تجویز'] },
      { key: 'ePrescription', label: 'تجویز الکترونیک', type: 'text', aliases: ['تجویز الکترونیک'] },
      { key: 'inDocs', label: 'حضور در دفتر اسناد', type: 'text', aliases: ['حضور در دفتر اسناد'] },
      { key: 'webOnly', label: 'صرفاً وبی', type: 'text', aliases: ['صرفا وبی'] },
      { key: 'minPrice', label: 'حداقل قیمت', type: 'money', aliases: ['حداقل قیمت'] },
      { key: 'lists', label: 'فهرست', type: 'text', aliases: ['فهرست'] },
      { key: 'effectiveDate', label: 'تاریخ اعمال', type: 'text', aliases: ['تاریخ اعمال'] },
    ],
  },
  {
    id: 'sales', title: 'فروش داروپردازان', hint: 'خروجی فروش نرم‌افزار نسخه‌پیچی', table: 'sales', stage: 7,
    fields: [
      { key: 'date', label: 'تاریخ', type: 'text', required: true, aliases: ['تاریخ'] },
      { key: 'rxNumber', label: 'شمارهٔ نسخه', type: 'text', aliases: ['شماره نسخه', 'نسخه'] },
      { key: 'drug', label: 'دارو', type: 'text', required: true, aliases: ['دارو', 'نام دارو'] },
      { key: 'quantity', label: 'تعداد', type: 'number', required: true, aliases: ['تعداد'] },
      { key: 'total', label: 'مبلغ کل', type: 'money', required: true, aliases: ['مبلغ کل', 'جمع'] },
    ],
  },
];

export const isSlotOpen = (slot: SlotDef) => slot.stage <= CURRENT_STAGE;

// ---------- خواندن فایل ----------

export interface SheetData {
  name: string;
  rows: unknown[][];
}

export class UnreadableFile extends Error {}

/** فایل CSV فارسی یا UTF-8 است یا ویندوز-۱۲۵۶؛ اول UTF-8 امتحان می‌شود. */
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1256').decode(buffer);
  }
}

export function readWorkbook(buffer: ArrayBuffer, fileName: string): SheetData[] {
  const isText = /\.(csv|txt|tsv)$/i.test(fileName);
  try {
    const book = isText
      ? XLSX.read(decodeCsv(buffer), { type: 'string', raw: true })
      : XLSX.read(buffer, { type: 'array' });
    return book.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, blankrows: false, defval: null }),
    })).filter((sheet) => sheet.rows.length > 0);
  } catch {
    throw new UnreadableFile(
      /\.xls$/i.test(fileName)
        ? 'فایل را در Excel باز کنید و با فرمت xlsx ذخیره کنید.'
        : 'این فایل خوانده نشد. فایل اکسل یا CSV بدهید.',
    );
  }
}

/** سرستون معمولاً ردیفی است که بیشترین خانهٔ متنی را دارد (بالای فایل‌ها گاهی عنوان هست). */
export function detectHeaderRow(rows: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 20).forEach((row, i) => {
    const score = row.filter((c) => typeof c === 'string' && parseNumber(c) === null && normalizeText(c) !== '').length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** سرستون‌ها به تعداد واقعی ستون‌های داده؛ سرستون جاافتاده «ستون n» نامیده می‌شود. */
export function headersOf(rows: unknown[][], headerRow: number): string[] {
  const count = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
  const header = rows[headerRow] ?? [];
  return Array.from({ length: count }, (_, i) => normalizeText(header[i]) || `ستون ${i + 1}`);
}

export const signatureOf = (rows: unknown[][], headerRow: number) =>
  (rows[headerRow] ?? []).map(matchKey).join('|');

/** حدس نگاشت از روی نام ستون: اول نام برابر، بعد نام شامل. هر ستون فقط یک بار استفاده می‌شود. */
export function guessColumns(headers: string[], fields: ImportField[]): Record<string, number> {
  const result: Record<string, number> = {};
  const used = new Set<number>();
  const take = (field: ImportField, index: number) => {
    result[field.key] = index;
    used.add(index);
  };
  const free = (field: ImportField) => result[field.key] === undefined;
  for (const field of fields.filter(free)) {
    const hit = headers.findIndex((h, i) => !used.has(i) && field.aliases.some((a) => matchKey(a) === matchKey(h)));
    if (hit >= 0) take(field, hit);
  }
  for (const field of fields.filter(free)) {
    const hit = headers.findIndex(
      (h, i) => !used.has(i) && field.aliases.some((a) => a.length > 2 && matchKey(h).includes(matchKey(a))),
    );
    if (hit >= 0) take(field, hit);
  }
  return result;
}

// ---------- قالب‌های آمادهٔ فهرست بیمه ----------

export interface Detected extends ImportMapping {
  headerRow: number;
  source: 'template' | 'tamin' | 'salamat' | 'guess';
  insurerHint?: string;
  insurerId?: number;
}

/** فارماکوپهٔ تأمین: خروجی Crystal Reports؛ سرستون‌ها جابه‌جا هستند، پس ستون‌ها از روی داده تعیین شده‌اند. */
const TAMIN_COLUMNS: Record<string, number> = {
  name: 0, brandCode: 1, ePrescription: 2, price: 3, subsidy: 4, shareRate: 5, coveredPrice: 6, minPrice: 8,
  inDocs: 9, caseBased: 10, webOnly: 11, prescribeLimit: 12, hospital: 13, status: 14,
};

const SALAMAT_HEADERS: Record<string, string> = {
  genericCode: 'کد ژنریک',
  brandCode: 'کد برند',
  name: 'عنوان',
  conditions: 'شرایط تعهد',
  form: 'شکل',
  dose: 'دوز',
  subsidy: 'یارانه ارزی',
  insurerAmount: 'مبلغ سهم سازمان با احتساب یارانه ارزی',
  shareRate: 'درصد سهم سازمان با احتساب یارانه ارزی',
  netPrice: 'قیمت',
  price: 'قیمت کل مورد درتعهد با احتساب یارانه ارزی',
  nominalRate: 'سهم سازمان',
  effectiveDate: 'تاریخ اعمال',
  lists: 'فهرست',
};

/** نگاشت اولیهٔ فایل: اول قالب ذخیره‌شده، بعد قالب آماده، بعد حدس از روی نام ستون. */
export function detectMapping(slot: SlotDef, rows: unknown[][], templates: ImportTemplate[] = []): Detected {
  for (const template of templates) {
    if (signatureOf(rows, template.headerRow) === template.signature) {
      return { ...template, source: 'template' };
    }
  }
  if (slot.id === 'coverage') {
    if ((rows[0] ?? []).some((c) => normalizeText(c).includes('فارماکوپه'))) {
      return { columns: TAMIN_COLUMNS, headerRow: 1, moneyUnit: 'rial', source: 'tamin', insurerHint: 'تأمین' };
    }
    const row = detectHeaderRow(rows);
    const headers = headersOf(rows, row).map(matchKey);
    if (headers.includes(matchKey('کد برند')) && headers.some((h) => h.includes('مبلغ سهم سازمان'))) {
      const columns: Record<string, number> = {};
      for (const [field, title] of Object.entries(SALAMAT_HEADERS)) {
        const index = headers.indexOf(matchKey(title));
        if (index >= 0) columns[field] = index;
      }
      return { columns, headerRow: row, moneyUnit: 'rial', source: 'salamat', insurerHint: 'سلامت' };
    }
  }
  const headerRow = detectHeaderRow(rows);
  return { columns: guessColumns(headersOf(rows, headerRow), slot.fields), headerRow, moneyUnit: 'rial', source: 'guess' };
}

// ---------- تبدیل ردیف‌ها ----------

export interface RowIssue {
  row: number; // شمارهٔ ردیف در فایل
  message: string;
}

export interface MappedRows {
  records: Record<string, unknown>[];
  issues: RowIssue[];
  /** ردیف وارد شده ولی یک فیلد غیرضروری آن خوانده نشده */
  notes: RowIssue[];
  emptyRows: number;
  duplicates: number;
}

/** خانهٔ چندخطی: «100 و 70 در دو خط». هر خط جداگانه خوانده می‌شود. */
function multiLine(value: unknown): string[] | null {
  const lines = String(value).trim().split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? lines : null;
}

export function convertCell(
  value: unknown,
  type: FieldType,
  unit: Unit,
): { value?: unknown; bad?: boolean; all?: number[] } {
  if (value === null || value === undefined || normalizeText(value) === '') return {};
  const lines = type === 'money' || type === 'percent' ? multiLine(value) : null;
  if (lines) {
    // سهم بسته به شرایط فرق می‌کند: کمترین مقدار مبنا می‌شود تا طلب از بیمه بیشتر از واقع دیده نشود.
    const all = lines.map((l) => convertCell(l, type, unit).value as number | undefined);
    if (all.some((n) => n === undefined)) return { bad: true };
    return { value: Math.min(...(all as number[])), all: all as number[] };
  }
  switch (type) {
    case 'text':
      return { value: normalizeText(value) };
    case 'number': {
      const n = parseNumber(value);
      return n === null ? { bad: true } : { value: n };
    }
    case 'money': {
      const n = parseNumber(value);
      return n === null ? { bad: true } : { value: toRial(n, unit) };
    }
    case 'percent': {
      const n = parsePercent(value);
      return n === null ? { bad: true } : { value: n };
    }
    case 'month': {
      const m = parseMonth(value);
      return m === null ? { bad: true } : { value: m };
    }
  }
}

export function mapRows(rows: unknown[][], headerRow: number, fields: ImportField[], mapping: ImportMapping): MappedRows {
  const out: MappedRows = { records: [], issues: [], notes: [], emptyRows: 0, duplicates: 0 };
  const seen = new Set<string>();
  rows.slice(headerRow + 1).forEach((row, i) => {
    const fileRow = headerRow + i + 2;
    if (row.every((c) => normalizeText(c) === '')) {
      out.emptyRows++;
      return;
    }
    const record: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const field of fields) {
      const index = mapping.columns[field.key];
      const cell = index === undefined ? {} : convertCell(row[index], field.type, mapping.moneyUnit);
      if (cell.bad && field.required) problems.push(`«${field.label}» معتبر نیست`);
      else if (cell.bad) out.notes.push({ row: fileRow, message: `«${field.label}» خوانده نشد و خالی ماند` });
      else if (cell.value !== undefined) {
        record[field.key] = cell.value;
        if (cell.all) record[`${field.key}All`] = cell.all;
      }
      else if (field.required) problems.push(`«${field.label}» خالی است`);
    }
    if (problems.length) {
      out.issues.push({ row: fileRow, message: problems.join('، ') });
      return;
    }
    const key = JSON.stringify(record);
    if (seen.has(key)) {
      out.duplicates++;
      out.issues.push({ row: fileRow, message: 'ردیف تکراری' });
      return;
    }
    seen.add(key);
    out.records.push(record);
  });
  return out;
}

/** کنترل محتوا: ستونی که عددی است ولی بیشتر خانه‌هایش عدد نیست، احتمالاً اشتباه نگاشت شده. */
export function columnWarnings(rows: unknown[][], headerRow: number, fields: ImportField[], mapping: ImportMapping) {
  const warnings: Record<string, string> = {};
  const data = rows.slice(headerRow + 1, headerRow + 301);
  for (const field of fields) {
    const index = mapping.columns[field.key];
    if (index === undefined || field.type === 'text') continue;
    const cells = data.map((r) => r[index]).filter((c) => normalizeText(c) !== '');
    const bad = cells.filter((c) => convertCell(c, field.type, mapping.moneyUnit).bad).length;
    if (cells.length > 0 && bad / cells.length > 0.1) warnings[field.key] = 'مقدارهای این ستون به این فیلد نمی‌خورد';
  }
  return warnings;
}

/** کنترل تأمین: قیمت − یارانه باید با جمع مورد قبول برابر باشد. */
export function balanceCheck(records: Record<string, unknown>[]): { ok: number; total: number } | null {
  const usable = records.filter((r) => r.price !== undefined && r.subsidy !== undefined && r.coveredPrice !== undefined);
  if (usable.length === 0) return null;
  const ok = usable.filter((r) => (r.price as number) - (r.subsidy as number) === r.coveredPrice).length;
  return { ok, total: usable.length };
}

// ---------- نوشتن در پایگاه داده ----------

const DEFAULTS: Record<string, () => Record<string, unknown>> = {
  insurers: () => ({ ...newInsurer('') }),
  distributors: () => ({ baseChequeMonths: 3, earlyPayDiscountPerMonth: 0 }),
  doctors: () => ({
    specialty: '', rxPerDay: 0, workDays: 26, startMonth: currentMonthKey(), insurerMix: { 0: 1 }, captureRate: 0.7,
    officeRent: 0, pharmacyRentShare: 0, monthlyAllowance: 0, active: true,
  }),
  fixedCosts: () => ({ startMonth: currentMonthKey() }),
};

export interface CommitResult {
  added: number;
  updated: number;
}

/** ردیف‌هایی که قبلاً هست (با فیلد کلید) به‌روز می‌شوند و بقیه اضافه؛ همه با هم یا هیچ‌کدام. */
export async function commitRows(slot: SlotDef, records: Record<string, unknown>[]): Promise<CommitResult> {
  const table = db.table(slot.table);
  const result: CommitResult = { added: 0, updated: 0 };
  await db.transaction('rw', table, async () => {
    const byKey = new Map<string, { id: number }>();
    if (slot.keyField) {
      for (const row of await table.toArray()) byKey.set(matchKey(row[slot.keyField]), row);
    }
    for (const record of records) {
      const key = slot.keyField ? matchKey(record[slot.keyField]) : '';
      const match = byKey.get(key);
      if (key && match) {
        await table.update(match.id, record);
        result.updated++;
      } else {
        const id = await table.add({ ...DEFAULTS[slot.table]?.(), ...record });
        if (key) byKey.set(key, { id: id as number });
        result.added++;
      }
    }
  });
  return result;
}

/** وضعیت یک محل ورود و قالب فایل را ذخیره می‌کند؛ قالب هم‌امضا جایگزین می‌شود. */
export async function saveSlot(slot: SlotDef, patch: Partial<ImportSlot>, template?: ImportTemplate): Promise<void> {
  const current = await db.importSlots.get(slot.id);
  const templates = (current?.templates ?? []).filter((t) => t.signature !== template?.signature);
  await db.importSlots.put({
    id: slot.id, title: slot.title, table: slot.table, status: 'empty', ...current, ...patch,
    templates: template ? [...templates, template] : templates,
  });
}
