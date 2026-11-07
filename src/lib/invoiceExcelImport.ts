import * as XLSX from 'xlsx';
import { parseInvoiceJson, type DraftInvoice, type ParseResult } from './invoice';
import { normalizeText, parseNumber } from './text';

// تبدیل هوشمند فایل اکسل (.xlsx / .xls / .csv) فاکتور شرکت‌های پخش به ساختار JSON استاندارد فاکتور و DraftInvoice

type FieldKey =
  | 'row'
  | 'name'
  | 'irc'
  | 'generic_code'
  | 'form'
  | 'strength'
  | 'batch'
  | 'expiry'
  | 'qty'
  | 'bonus_qty'
  | 'unit_price'
  | 'consumer_price'
  | 'discount_percent'
  | 'discount_amount'
  | 'tax_amount'
  | 'line_total'
  | 'distributor'
  | 'invoice_no'
  | 'invoice_date'
  | 'cheque_months'
  | 'due_date'
  | 'payment_type';

/** فرهنگ لغت جامع سرستون‌های مترادف در شرکت‌های پخش دارویی ایران */
const HEADER_SYNONYMS: Record<FieldKey, string[]> = {
  row: ['ردیف', 'شماره ردیف', 'row', '#', 'رديف'],
  name: [
    'نام دارو در فاکتور', 'نام دارو', 'شرح کالا', 'نام کالا', 'شرح دارو', 'نام و مشخصات کالا',
    'مشخصات کالا', 'نام تجاری', 'عنوان کالا', 'کالا', 'محصول', 'دارو', 'شرح', 'name', 'description', 'item', 'drug',
  ],
  irc: ['کد irc', 'irc', 'کد رهگیری', 'کد 16 رقمی', 'کد ۱۶ رقمی', 'شناسه کالا', 'gtin', 'کد وزارت بهداشت'],
  generic_code: ['کد ژنریک', 'کد کالا', 'کد دارو', 'کد محصول', 'کد سیستم', 'generic_code', 'generic code', 'code'],
  form: ['شکل دارویی', 'شکل', 'فرم دارویی', 'نوع کالا', 'واحد کالا', 'form'],
  strength: ['دوز', 'قدرت', 'مقدار ماده موثره', 'وزن', 'حجم', 'strength', 'dose'],
  batch: ['سری ساخت (بچ)', 'سری ساخت', 'بچ', 'شماره ساخت', 'شماره بچ', 'بچ نامبر', 'batch', 'lot', 'batch no'],
  expiry: ['تاریخ انقضا', 'انقضا', 'انقضاء', 'تاريخ انقضا', 'expiry', 'exp', 'exp date', 'expiration'],
  qty: [
    'تعداد خرید', 'تعداد', 'مقدار', 'تعداد فروش', 'تعداد درخواستی', 'تعداد تحویلی',
    'تعداد کل خرید', 'بسته', 'تعداد سفارش', 'qty', 'quantity', 'count',
  ],
  bonus_qty: [
    'تعداد جایزه (آفر)', 'تعداد جایزه', 'جایزه', 'بونوس', 'آفر', 'اشانتیون', 'رایگان',
    'هدیه', 'تعداد رایگان', 'تعداد آفر', 'آفر کالایی', 'bonus_qty', 'bonus', 'free', 'offer',
  ],
  unit_price: [
    'فی خرید واحد (ریال)', 'فی خرید واحد', 'فی خرید', 'فی واحد', 'فی', 'قیمت واحد', 'بهای واحد',
    'فی پایه', 'نرخ واحد', 'نرخ', 'قیمت خرید', 'فی فروش', 'قیمت فروش پخش', 'بهای فروش',
    'قیمت دارنده پروانه', 'مبلغ واحد', 'ارزش واحد', 'unit_price', 'unit price', 'price', 'fee',
  ],
  consumer_price: [
    'قیمت مصرف‌کننده (ریال)', 'قیمت مصرف کننده (ریال)', 'قیمت مصرف‌کننده', 'قیمت مصرف کننده',
    'فی مصرف‌کننده', 'فی مصرف کننده', 'بهای مصرف‌کننده', 'بهای مصرف کننده', 'مصرف‌کننده', 'مصرف کننده',
    'قیمت بیمار', 'قیمت روی جعبه', 'فی مشتری', 'consumer_price', 'consumer price',
  ],
  discount_percent: [
    'درصد تخفیف (٪)', 'درصد تخفیف (%)', 'درصد تخفیف', '٪ تخفیف', '% تخفیف', 'تخفیف درصد',
    'نرخ تخفیف', 'discount_percent', 'discount %', 'discount rate',
  ],
  discount_amount: [
    'مبلغ تخفیف (ریال)', 'مبلغ تخفیف', 'تخفیف (ریال)', 'تخفیف', 'جمع تخفیف', 'کسر',
    'تخفیف نقدی', 'تخفیف حجمی', 'تخفیف کالایی', 'discount_amount', 'discount',
  ],
  tax_amount: [
    'مالیات و عوارض (ریال)', 'مالیات و عوارض', 'مالیات (ریال)', 'مالیات', 'ارزش افزوده',
    'جمع مالیات و عوارض', 'جمع مالیات', 'عوارض', 'tax_amount', 'tax', 'vat',
  ],
  line_total: [
    'جمع قابل پرداخت سطر (ریال)', 'جمع قابل پرداخت سطر', 'جمع سطر (ریال)', 'جمع ردیف (ریال)',
    'جمع سطر', 'جمع ردیف', 'مبلغ خالص', 'مبلغ کل', 'قابل پرداخت ردیف', 'خالص پرداختی',
    'جمع پس از تخفیف', 'مبلغ نهایی سطر', 'مبلغ نهایی', 'جمع کل ردیف', 'line_total', 'total', 'net amount', 'payable',
  ],
  distributor: ['شرکت پخش', 'نام شرکت پخش', 'پخش', 'تامین کننده', 'فروشنده', 'distributor'],
  invoice_no: ['شماره فاکتور', 'شماره صورتحساب', 'کد فاکتور', 'فاکتور', 'invoice_no', 'invoice number'],
  invoice_date: ['تاریخ فاکتور', 'تاریخ صورتحساب', 'تاریخ خرید', 'تاریخ', 'invoice_date', 'date'],
  cheque_months: ['مدت چک (ماه)', 'مهلت چک (ماه)', 'مدت چک', 'مهلت تسویه', 'راس چک', 'cheque_months'],
  due_date: ['تاریخ سررسید', 'سررسید', 'سررسید چک', 'due_date'],
  payment_type: ['نوع پرداخت', 'روش پرداخت', 'نحوه تسویه', 'payment_type'],
};

function cleanHeader(raw: unknown): string {
  return normalizeText(String(raw ?? ''))
    .toLowerCase()
    .replace(/[()[\]٪%.:،,\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchHeaderToField(headerText: unknown): FieldKey | null {
  const cleaned = cleanHeader(headerText);
  if (!cleaned) return null;

  // رد کردن ستون‌های محاسباتی خروجی که نباید با فی یا تعداد اشتباه شوند
  if (
    cleaned.includes('تمام شده') ||
    cleaned.includes('کل تعداد دریافتی') ||
    cleaned.includes('نام ژنریک')
  ) {
    return null;
  }

  // ۱. تطبیق دقیق
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS) as [FieldKey, string[]][]) {
    for (const syn of synonyms) {
      if (cleaned === cleanHeader(syn)) return field;
    }
  }

  // ۲. تطبیق زیررشته‌ای با اولویت عبارات طولانی‌تر
  const candidates: { field: FieldKey; len: number }[] = [];
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS) as [FieldKey, string[]][]) {
    for (const syn of synonyms) {
      const cleanSyn = cleanHeader(syn);
      if (cleanSyn.length >= 2 && cleaned.includes(cleanSyn)) {
        candidates.push({ field, len: cleanSyn.length });
      }
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.len - a.len);
    return candidates[0].field;
  }

  return null;
}

function normalizePaymentType(raw: unknown): 'cash' | 'cheque' | 'mixed' | 'credit' {
  const t = normalizeText(String(raw ?? '')).toLowerCase();
  if (t.includes('نقد') || t === 'cash') return 'cash';
  if (t.includes('ترکیب') || t === 'mixed') return 'mixed';
  if (t.includes('نسیه') || t.includes('اعتبار') || t === 'credit') return 'credit';
  return 'cheque';
}

export interface ExcelInvoiceConversionResult {
  ok: true;
  json: string;
  draft: DraftInvoice;
}

export interface ExcelInvoiceConversionError {
  ok: false;
  errors: string[];
}

/**
 * خواندن بافر فایل اکسل (.xlsx / .xls / .csv) و تبدیل آن به JSON استاندارد فاکتور و DraftInvoice
 */
export function convertExcelBufferToInvoice(buffer: ArrayBuffer): ExcelInvoiceConversionResult | ExcelInvoiceConversionError {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch {
    return { ok: false, errors: ['فایل اکسل قابل خواندن نیست. مطمئن شوید فایل سالم و با فرمت .xlsx یا .xls یا .csv باشد.'] };
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { ok: false, errors: ['فایل اکسل هیچ برگه‌ای ندارد.'] };
  }

  let distributor = '';
  let invoiceNo = '';
  let invoiceDate = '';
  let paymentType: 'cash' | 'cheque' | 'mixed' | 'credit' = 'cheque';
  let chequeMonths: number | null = 3;
  let dueDate: string | null = null;
  let payableTotal: number | null = null;
  const warnings: string[] = [];

  // ۱. اگر برگهٔ «مشخصات فاکتور» وجود دارد، ابتدا اطلاعات کلی را از آن بخوانیم
  const metaSheetName = wb.SheetNames.find((n) => n.includes('مشخصات') || n.toLowerCase().includes('meta') || n.toLowerCase().includes('info'));
  if (metaSheetName) {
    const metaRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[metaSheetName], { header: 1, defval: '' });
    for (const r of metaRows) {
      if (!Array.isArray(r) || r.length < 2) continue;
      const key = cleanHeader(r[0]);
      const val = String(r[1] ?? '').trim();
      if (!key || !val || val === '—') continue;
      if (key.includes('شرکت پخش') || key.includes('فروشنده') || key === 'پخش') distributor = val;
      else if (key.includes('شماره فاکتور') || key.includes('شماره صورتحساب')) invoiceNo = val;
      else if (key.includes('تاریخ فاکتور') || key.includes('تاریخ خرید')) invoiceDate = val;
      else if (key.includes('نوع پرداخت') || key.includes('روش پرداخت')) paymentType = normalizePaymentType(val);
      else if (key.includes('مدت چک') || key.includes('مهلت چک')) chequeMonths = parseNumber(val);
      else if (key.includes('سررسید')) dueDate = val;
      else if (key.includes('قابل پرداخت نهایی') || key.includes('قابل پرداخت')) payableTotal = parseNumber(val);
      else if (key.includes('توضیحات') || key.includes('هشدار')) warnings.push(val);
    }
  }

  // ۲. پیدا کردن برگهٔ اصلی اقلام فاکتور
  const itemsSheetName =
    wb.SheetNames.find((n) => n.includes('اقلام') || n.includes('فاکتور') || n.toLowerCase().includes('item')) ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[itemsSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  if (matrix.length === 0) {
    return { ok: false, errors: ['برگهٔ اکسل خالی است.'] };
  }

  // پیدا کردن سطر سرستون‌ها (سطری که حداقل ۲ ستون کلیدی مثل نام دارو و فی/تعداد را داشته باشد)
  let headerRowIdx = -1;
  const colMap = new Map<number, FieldKey>();

  for (let rIdx = 0; rIdx < Math.min(matrix.length, 25); rIdx++) {
    const row = matrix[rIdx];
    if (!Array.isArray(row)) continue;

    const candidateMap = new Map<number, FieldKey>();
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const matched = matchHeaderToField(row[cIdx]);
      if (matched && ![...candidateMap.values()].includes(matched)) {
        candidateMap.set(cIdx, matched);
      }
    }

    const fieldsFound = new Set(candidateMap.values());
    const hasName = fieldsFound.has('name');
    const hasQtyOrPrice = fieldsFound.has('qty') || fieldsFound.has('unit_price') || fieldsFound.has('line_total');

    if (hasName && hasQtyOrPrice) {
      headerRowIdx = rIdx;
      candidateMap.forEach((v, k) => colMap.set(k, v));
      break;
    }

    // اگر قبل از جدول اصلی، ردیف‌های کلید-مقدار بالای برگه نوشته شده باشد (مثلاً شرکت پخش: البرز)
    if (row.length >= 2) {
      const k = cleanHeader(row[0]);
      const v = String(row[1] ?? '').trim();
      if (k && v && v !== '—') {
        if (!distributor && (k.includes('شرکت پخش') || k.includes('فروشنده'))) distributor = v;
        if (!invoiceNo && k.includes('شماره فاکتور')) invoiceNo = v;
        if (!invoiceDate && k.includes('تاریخ فاکتور')) invoiceDate = v;
      }
    }
  }

  if (headerRowIdx === -1) {
    return {
      ok: false,
      errors: [
        'سرستون‌های جدول فاکتور در فایل اکسل پیدا نشد. جدول اکسل باید حداقل ستون «نام دارو/شرح کالا» و «تعداد» یا «فی/قیمت واحد» را داشته باشد.',
      ],
    };
  }

  const items: Record<string, unknown>[] = [];

  for (let rIdx = headerRowIdx + 1; rIdx < matrix.length; rIdx++) {
    const row = matrix[rIdx];
    if (!Array.isArray(row)) continue;

    const getVal = (field: FieldKey): unknown => {
      for (const [colIdx, f] of colMap.entries()) {
        if (f === field) return row[colIdx];
      }
      return undefined;
    };

    const rawName = normalizeText(String(getVal('name') ?? ''));
    if (!rawName) continue;

    // رد کردن سطر «جمع کل فاکتور» در انتهای جدول اکسل
    if (
      rawName === 'جمع کل فاکتور' ||
      rawName === 'جمع کل' ||
      rawName === 'جمع' ||
      rawName.startsWith('جمع کل ')
    ) {
      const footerPayable = parseNumber(getVal('line_total'));
      if (footerPayable && !payableTotal) payableTotal = footerPayable;
      continue;
    }

    // اگر ستون شرکت پخش یا شماره فاکتور در هر سطر تکرار شده باشد
    if (!distributor) {
      const rowDist = normalizeText(String(getVal('distributor') ?? ''));
      if (rowDist && rowDist !== '—') distributor = rowDist;
    }
    if (!invoiceNo) {
      const rowInvNo = normalizeText(String(getVal('invoice_no') ?? ''));
      if (rowInvNo && rowInvNo !== '—') invoiceNo = rowInvNo;
    }
    if (!invoiceDate) {
      const rowInvDate = normalizeText(String(getVal('invoice_date') ?? ''));
      if (rowInvDate && rowInvDate !== '—') invoiceDate = rowInvDate;
    }

    const cleanCell = (v: unknown): string | null => {
      const s = normalizeText(String(v ?? ''));
      return !s || s === '—' || s === '-' || s.toLowerCase() === 'null' ? null : s;
    };

    const numCell = (v: unknown, fallback: number | null = 0): number | null => {
      if (v === null || v === undefined || v === '' || v === '—' || v === '-') return fallback;
      const n = parseNumber(v);
      return n === null ? fallback : n;
    };

    const qty = numCell(getVal('qty'), 0) ?? 0;
    const bonusQty = numCell(getVal('bonus_qty'), 0) ?? 0;
    const unitPrice = numCell(getVal('unit_price'), 0) ?? 0;
    const consumerPrice = numCell(getVal('consumer_price'), 0) ?? 0;
    const discountPercent = numCell(getVal('discount_percent'), 0) ?? 0;
    const discountAmount = numCell(getVal('discount_amount'), 0) ?? 0;
    const taxAmount = numCell(getVal('tax_amount'), 0) ?? 0;
    const lineTotal = numCell(getVal('line_total'), null);

    if (qty === 0 && bonusQty === 0 && unitPrice === 0) continue;

    items.push({
      row: items.length + 1,
      name: rawName,
      irc: cleanCell(getVal('irc')),
      generic_code: cleanCell(getVal('generic_code')),
      form: cleanCell(getVal('form')),
      strength: cleanCell(getVal('strength')),
      batch: cleanCell(getVal('batch')) ?? '',
      expiry: cleanCell(getVal('expiry')) ?? '',
      qty,
      bonus_qty: bonusQty,
      unit_price: unitPrice,
      consumer_price: consumerPrice,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      line_total: lineTotal,
    });
  }

  if (items.length === 0) {
    return { ok: false, errors: ['هیچ سطر دارویی در فایل اکسل پیدا نشد.'] };
  }

  const invoicePayload = {
    distributor,
    invoice_no: invoiceNo,
    invoice_date: invoiceDate || null,
    payment: {
      type: paymentType,
      cheque_months: chequeMonths,
      due_date: dueDate,
      notes: '',
    },
    items,
    totals: {
      gross: 0,
      discount: 0,
      tax: 0,
      payable: payableTotal ?? 0,
    },
    currency_note: '',
    warnings,
  };

  const json = JSON.stringify(invoicePayload, null, 2);
  const parsed: ParseResult = parseInvoiceJson(json);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  return {
    ok: true,
    json,
    draft: parsed.draft,
  };
}
