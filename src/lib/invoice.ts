import { lineFigures } from './calc';
import {
  db, type Cheque, type Coverage, type Distributor, type Drug, type DrugAlias, type InventoryLot, type Invoice, type InvoiceItem,
  type InvoicePayment, type PaymentType,
} from './db';
import { doseKey, nameSimilarity } from './drugname';
import { faNumber } from './format';
import { addJalaliMonths, parseJalaliDate, todayISO } from './jalali';
import { matchKey, normalizeText, parseNumber } from './text';

// فاکتور خرید: اعتبارسنجی JSON، تطبیق با بانک دارو، ساخت چک و ذخیره.

export type MatchKind = 'code' | 'alias' | 'confirmed' | 'manual';

export interface Suggestion {
  drugId: number;
  score: number;
}

export interface DraftItem {
  key: number;
  name: string;
  irc: string;
  genericCode: string;
  form: string;
  strength: string;
  batch: string;
  expiry: string;
  qty: number;
  bonus: number;
  unitPrice: number;
  consumerPrice: number;
  /** کسر؛ ۱۲٪ = 0.12 */
  discountPercent: number;
  discountAmount: number;
  tax: number;
  /** جمع سطر طبق فایل، برای مقایسه */
  fileTotal: number | null;
  /** خانه‌هایی که در فایل خوانا نبوده‌اند */
  unreadable: string[];
  drugId: number | null;
  matchedBy: MatchKind | null;
  suggestions: Suggestion[];
}

export interface DraftCheque {
  key: number;
  id?: number;
  amount: number;
  dueDate: string | null;
  status: 'pending' | 'paid';
}

export interface DraftInvoice {
  id?: number;
  distributor: string;
  number: string;
  date: string | null;
  payment: InvoicePayment;
  items: DraftItem[];
  /** جمع قابل پرداخت طبق فایل */
  filePayable: number | null;
  currencyNote: string;
  fileWarnings: string[];
  cheques: DraftCheque[];
  chequesEdited: boolean;
}

let nextKey = 1;
export const newKey = () => nextKey++;

export const emptyItem = (): DraftItem => ({
  key: newKey(), name: '', irc: '', genericCode: '', form: '', strength: '', batch: '', expiry: '',
  qty: 0, bonus: 0, unitPrice: 0, consumerPrice: 0, discountPercent: 0, discountAmount: 0, tax: 0,
  fileTotal: null, unreadable: [], drugId: null, matchedBy: null, suggestions: [],
});

export const emptyDraft = (): DraftInvoice => ({
  distributor: '', number: '', date: todayISO(),
  payment: { type: 'cheque', chequeMonths: 3, dueDate: null, notes: '' },
  items: [emptyItem()], filePayable: null, currencyNote: '', fileWarnings: [], cheques: [], chequesEdited: false,
});

// ---------- اعتبارسنجی JSON ----------

export type ParseResult = { ok: true; draft: DraftInvoice } | { ok: false; errors: string[] };

const PAYMENT_TYPES: PaymentType[] = ['cash', 'cheque', 'mixed', 'credit'];

/** بعضی هوش مصنوعی‌ها JSON را داخل ``` یا با جملهٔ اضافه می‌دهند؛ فقط بخش آکولاد برداشته می‌شود. */
function jsonPart(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export function parseInvoiceJson(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, errors: ['کادر خالی است. خروجی هوش مصنوعی را بچسبانید.'] };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonPart(text));
  } catch {
    return {
      ok: false,
      errors: ['این متن JSON معتبر نیست. مطمئن شوید کل خروجی را کپی کرده‌اید و متن وسط کار قطع نشده است.'],
    };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['ساختار خروجی درست نیست؛ باید یک فاکتور باشد.'] };
  }
  if (!Array.isArray(data.items)) return { ok: false, errors: ['بخش items (سطرهای فاکتور) در خروجی نیست.'] };
  if (data.items.length === 0) return { ok: false, errors: ['فاکتور هیچ سطری ندارد.'] };

  const errors: string[] = [];
  const warnings = Array.isArray(data.warnings) ? data.warnings.map((w) => String(w ?? '').trim()).filter(Boolean) : [];

  const items = data.items.map((raw, i) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const label = `ردیف ${faNumber(i + 1)}`;
    const item = emptyItem();
    item.name = normalizeText(row.name);
    if (!item.name) item.unreadable.push('نام');
    const number = (key: string, title: string, fallback: number) => {
      const value = row[key];
      if (value === null || value === undefined || value === '') return fallback;
      const n = parseNumber(value);
      if (n === null) {
        errors.push(`${label}: «${title}» عدد نیست (${String(value)}).`);
        return fallback;
      }
      if (n < 0) {
        errors.push(`${label}: «${title}» منفی است.`);
        return fallback;
      }
      return n;
    };
    const must = (key: string, title: string) => {
      if (row[key] === null || row[key] === undefined || row[key] === '') item.unreadable.push(title);
      return number(key, title, 0);
    };
    item.qty = must('qty', 'تعداد');
    item.unitPrice = must('unit_price', 'فی');
    item.bonus = number('bonus_qty', 'بونوس', 0);
    item.consumerPrice = number('consumer_price', 'قیمت مصرف‌کننده', 0);
    item.discountPercent = number('discount_percent', 'درصد تخفیف', 0) / 100;
    item.discountAmount = number('discount_amount', 'مبلغ تخفیف', 0);
    item.tax = number('tax_amount', 'مالیات', 0);
    item.fileTotal = row.line_total === null || row.line_total === undefined ? null : number('line_total', 'جمع سطر', 0);
    item.irc = normalizeText(row.irc);
    item.genericCode = normalizeText(row.generic_code);
    item.form = normalizeText(row.form);
    item.strength = normalizeText(row.strength);
    item.batch = normalizeText(row.batch);
    item.expiry = normalizeText(row.expiry);
    return item;
  });

  if (errors.length) return { ok: false, errors };

  const payment = (data.payment ?? {}) as Record<string, unknown>;
  const type = PAYMENT_TYPES.find((t) => t === payment.type);
  if (!type) warnings.push('نوع پرداخت مشخص نبود؛ «چک» فرض شد. آن را بررسی کنید.');
  const date = parseJalaliDate(data.invoice_date);
  if (!date) warnings.push('تاریخ فاکتور خوانده نشد. آن را وارد کنید.');
  const dueRaw = payment.due_date;
  const dueDate = dueRaw ? parseJalaliDate(dueRaw) : null;
  if (dueRaw && !dueDate) warnings.push('سررسید فاکتور قابل خواندن نبود.');
  const totals = (data.totals ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    draft: {
      distributor: normalizeText(data.distributor),
      number: normalizeText(data.invoice_no),
      date,
      payment: {
        type: type ?? 'cheque',
        chequeMonths: parseNumber(payment.cheque_months),
        dueDate,
        notes: normalizeText(payment.notes),
      },
      items,
      filePayable: parseNumber(totals.payable) || null,
      currencyNote: String(data.currency_note ?? '').trim(),
      fileWarnings: warnings,
      cheques: [],
      chequesEdited: false,
    },
  };
}

// ---------- تطبیق با بانک دارو ----------

export interface MatchIndex {
  drugs: Drug[];
  byCode: Map<string, Drug>;
  byAlias: Map<string, number>;
}

export function buildMatchIndex(drugs: Drug[], aliases: DrugAlias[]): MatchIndex {
  const byCode = new Map<string, Drug>();
  for (const drug of drugs) for (const code of drug.codes) if (!byCode.has(code)) byCode.set(code, drug);
  return { drugs, byCode, byAlias: new Map(aliases.map((a) => [matchKey(a.alias), a.drugId])) };
}

/** سه داروی نزدیک به نام روی فاکتور. دوز یکسان امتیاز بیشتر می‌گیرد. */
export function suggestDrugs(name: string, strength: string, index: MatchIndex): Suggestion[] {
  if (normalizeText(name).length < 3) return [];
  const dose = doseKey(strength);
  const scored: Suggestion[] = [];
  for (const drug of index.drugs) {
    let score = Math.max(...drug.names.map((n) => nameSimilarity(n, name)));
    if (score < 0.45) continue;
    if (dose && doseKey(drug.dose) === dose) score += 0.2;
    scored.push({ drugId: drug.id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** اول کد (IRC یا ژنریک)، بعد نامی که قبلاً تأیید شده. نام تقریبی فقط پیشنهاد می‌شود و خودکار وصل نمی‌شود. */
export function matchItem(item: DraftItem, index: MatchIndex): DraftItem {
  if (item.drugId !== null) return item;
  const byCode = index.byCode.get(item.irc) ?? index.byCode.get(item.genericCode);
  if (byCode) return { ...item, drugId: byCode.id, matchedBy: 'code', suggestions: [] };
  const alias = index.byAlias.get(matchKey(item.name));
  if (alias !== undefined) return { ...item, drugId: alias, matchedBy: 'alias', suggestions: [] };
  return { ...item, suggestions: suggestDrugs(item.name, item.strength, index) };
}

/** قیمت مصرف‌کننده خالی از بانک پر می‌شود. */
export function fillPrice(item: DraftItem, drugs: Map<number, Drug>): DraftItem {
  if (item.consumerPrice > 0 || item.drugId === null) return item;
  return { ...item, consumerPrice: drugs.get(item.drugId)?.price ?? 0 };
}

// ---------- جمع‌ها، چک‌ها و هشدارها ----------

export const lineOf = (item: DraftItem) => lineFigures(item);

export const draftTotal = (draft: DraftInvoice) => draft.items.reduce((sum, item) => sum + lineOf(item).paid, 0);

/** مبلغ قابل پرداخت: جمع فاکتور اگر در فایل آمده، وگرنه جمع سطرها. */
export const payableOf = (draft: DraftInvoice) => draft.filePayable ?? draftTotal(draft);

/** چک پیشنهادی از روی شرایط پرداخت. نقد چک ندارد؛ در نسیه و ترکیبی هم مبلغ قابل ویرایش است. */
export function planCheques(draft: DraftInvoice): DraftCheque[] {
  const { payment, date } = draft;
  if (payment.type === 'cash') return [];
  const months = payment.chequeMonths ?? 0;
  const dueDate = payment.dueDate ?? (date && months ? addJalaliMonths(date, months) : date);
  return [{ key: newKey(), amount: Math.round(payableOf(draft)), dueDate, status: 'pending' }];
}

export interface ItemWarning {
  key: number;
  text: string;
}

export function priceMismatch(item: DraftItem, drug: Drug | undefined, coverage: Coverage[]): boolean {
  if (!drug || item.consumerPrice <= 0) return false;
  const known = [drug.price, ...coverage.map((c) => c.price)].filter((p) => p > 0);
  return known.length > 0 && !known.includes(item.consumerPrice);
}

/** هشدارهای بالای جدول. خطای مانع ذخیره جدا در saveProblems است. */
export function draftWarnings(
  draft: DraftInvoice,
  drugs: Map<number, Drug>,
  coverageByDrug: Map<number, Coverage[]>,
  duplicate: boolean,
): string[] {
  const out = [...draft.fileWarnings];
  if (draft.currencyNote) out.push(draft.currencyNote);
  if (duplicate) out.push('فاکتوری با همین شماره از همین شرکت قبلاً ثبت شده است.');
  draft.items.forEach((item, i) => {
    const label = `ردیف ${faNumber(i + 1)}`;
    if (item.unreadable.length) out.push(`${label}: ${item.unreadable.join('، ')} در فایل خوانا نبود.`);
    if (item.drugId === null) out.push(`${label}: به داروی بانک وصل نشده است.`);
    const drug = item.drugId === null ? undefined : drugs.get(item.drugId);
    if (priceMismatch(item, drug, coverageByDrug.get(item.drugId ?? -1) ?? [])) {
      out.push(
        `${label}: قیمت مصرف‌کنندهٔ فاکتور (${faNumber(item.consumerPrice)} ریال) با بانک دارو (${faNumber(drug!.price)} ریال) فرق دارد.`,
      );
    }
    if (item.consumerPrice === 0) out.push(`${label}: قیمت مصرف‌کننده ندارد، پس سود درست حساب نمی‌شود.`);
    if (item.fileTotal !== null) {
      const f = lineOf(item);
      const near = (a: number) => Math.abs(a - item.fileTotal!) <= 1;
      if (!near(f.paid) && !near(f.net) && !near(f.gross)) {
        out.push(`${label}: جمع سطر در فایل (${faNumber(item.fileTotal)} ریال) با محاسبه (${faNumber(f.paid, 1)} ریال) نمی‌خواند.`);
      }
    }
  });
  const total = draftTotal(draft);
  if (draft.filePayable !== null && Math.abs(draft.filePayable - total) > 1) {
    out.push(`جمع سطرها (${faNumber(total, 1)} ریال) با جمع فاکتور (${faNumber(draft.filePayable)} ریال) برابر نیست.`);
  }
  const cheques = draft.cheques.reduce((sum, c) => sum + c.amount, 0);
  if (cheques > payableOf(draft) + 1) out.push('جمع چک‌ها از مبلغ فاکتور بیشتر است.');
  return out;
}

/** چیزهایی که بدون آن‌ها ذخیره نمی‌شود. */
export function saveProblems(draft: DraftInvoice): string[] {
  const out: string[] = [];
  if (normalizeText(draft.distributor) === '') out.push('نام شرکت پخش را بنویسید.');
  if (!draft.date) out.push('تاریخ فاکتور را درست وارد کنید.');
  if (draft.items.length === 0) out.push('فاکتور باید دست‌کم یک سطر داشته باشد.');
  draft.items.forEach((item, i) => {
    if (normalizeText(item.name) === '') out.push(`نام ردیف ${faNumber(i + 1)} خالی است.`);
    if (item.qty + item.bonus <= 0) out.push(`تعداد ردیف ${faNumber(i + 1)} صفر است.`);
  });
  if (draft.cheques.some((c) => !c.dueDate)) out.push('سررسید همهٔ چک‌ها را وارد کنید.');
  return out;
}

// ---------- ذخیره ----------

export async function findDistributor(name: string): Promise<Distributor | undefined> {
  const key = matchKey(name);
  return (await db.distributors.toArray()).find((d) => matchKey(d.name) === key);
}

/** ذخیرهٔ کامل فاکتور: سطرها، بچ‌ها، چک‌ها و نام‌های تأییدشده، همه با هم یا هیچ‌کدام. */
export async function saveInvoice(input: DraftInvoice): Promise<number> {
  // چکی که دستی عوض نشده، همیشه از جمع فعلی فاکتور ساخته می‌شود.
  const draft = input.chequesEdited ? input : { ...input, cheques: planCheques(input) };
  const tables = [db.invoices, db.invoiceItems, db.inventoryLots, db.cheques, db.distributors, db.drugAliases, db.drugs];
  return db.transaction('rw', tables, async () => {
    let distributor = await findDistributor(draft.distributor);
    if (!distributor) {
      const row = {
        name: normalizeText(draft.distributor),
        baseChequeMonths: draft.payment.chequeMonths ?? 3,
        earlyPayDiscountPerMonth: 0,
      };
      distributor = { ...row, id: (await db.distributors.add(row as Distributor)) as number };
    }

    const invoice = {
      number: normalizeText(draft.number),
      date: draft.date!,
      distributorId: distributor.id,
      payment: draft.payment,
      payable: payableOf(draft),
      currencyNote: draft.currencyNote,
      warnings: draft.fileWarnings,
    };
    let invoiceId = draft.id;
    if (invoiceId) {
      await db.invoices.update(invoiceId, invoice);
      await db.invoiceItems.where('invoiceId').equals(invoiceId).delete();
      await db.inventoryLots.where('invoiceId').equals(invoiceId).delete();
      await db.cheques.where('invoiceId').equals(invoiceId).delete();
    } else {
      invoiceId = (await db.invoices.add(invoice as Invoice)) as number;
    }

    const items = draft.items.map((item) => {
      const f = lineOf(item);
      return {
        invoiceId,
        drugId: item.drugId,
        name: normalizeText(item.name),
        irc: item.irc || undefined,
        genericCode: item.genericCode || undefined,
        form: item.form || undefined,
        strength: item.strength || undefined,
        batch: item.batch || undefined,
        expiry: item.expiry || undefined,
        quantity: item.qty,
        bonus: item.bonus,
        unitPrice: item.unitPrice,
        consumerPrice: item.consumerPrice,
        discount: item.discountPercent,
        discountAmount: item.discountAmount,
        tax: item.tax,
        total: f.paid,
        effectiveUnitCost: f.unitCost,
        marginOnSale: f.marginOnSale,
        marginOnCost: f.marginOnCost,
      };
    });
    await db.invoiceItems.bulkAdd(items as InvoiceItem[]);

    await db.inventoryLots.bulkAdd(
      draft.items.map((item) => ({
        drugId: item.drugId,
        name: normalizeText(item.name),
        batch: item.batch || undefined,
        expiry: item.expiry || undefined,
        remaining: item.qty + item.bonus,
        source: `فاکتور ${normalizeText(draft.number) || 'بدون شماره'}`,
        invoiceId,
      })) as InventoryLot[],
    );

    await db.cheques.bulkAdd(
      draft.cheques.map((c) => ({
        distributorId: distributor.id,
        amount: c.amount,
        dueDate: c.dueDate!,
        status: c.status,
        invoiceId,
      })) as Cheque[],
    );

    // «نام روی فاکتور ← داروی بانک» تا دفعهٔ بعد خودکار باشد.
    const known = new Set((await db.drugAliases.toArray()).map((a) => matchKey(a.alias)));
    for (const item of draft.items) {
      const key = matchKey(item.name);
      if (item.matchedBy !== 'confirmed' || item.drugId === null || known.has(key)) continue;
      const drug = await db.drugs.get(item.drugId);
      if (drug?.names.some((n) => matchKey(n) === key)) continue;
      await db.drugAliases.add({ alias: normalizeText(item.name), drugId: item.drugId } as DrugAlias);
      known.add(key);
    }
    return invoiceId;
  });
}

export async function deleteInvoice(id: number): Promise<void> {
  await db.transaction('rw', db.invoices, db.invoiceItems, db.inventoryLots, db.cheques, async () => {
    await db.invoiceItems.where('invoiceId').equals(id).delete();
    await db.inventoryLots.where('invoiceId').equals(id).delete();
    await db.cheques.where('invoiceId').equals(id).delete();
    await db.invoices.delete(id);
  });
}

/** فاکتور ذخیره‌شده را برای ویرایش به پیش‌نویس برمی‌گرداند. */
export async function loadDraft(id: number): Promise<DraftInvoice> {
  const invoice = (await db.invoices.get(id))!;
  const items = await db.invoiceItems.where('invoiceId').equals(id).toArray();
  const cheques = await db.cheques.where('invoiceId').equals(id).toArray();
  const distributor = await db.distributors.get(invoice.distributorId);
  const itemsTotal = items.reduce((sum, row) => sum + row.total, 0);
  // جمع فاکتور فقط وقتی ثابت می‌ماند که با جمع سطرها فرق داشته باشد؛ وگرنه با تغییر سطرها باید عوض شود.
  const fixedPayable = Math.abs(invoice.payable - itemsTotal) > 1 ? invoice.payable : null;
  // یک چک پرداخت‌نشده به اندازهٔ کل فاکتور یعنی چک خودکار است؛ سررسیدش حفظ و مبلغش به‌روز می‌شود.
  const autoCheque =
    cheques.length === 1 && cheques[0].status === 'pending' && Math.abs(cheques[0].amount - invoice.payable) <= 1;
  return {
    id,
    distributor: distributor?.name ?? '',
    number: invoice.number,
    date: invoice.date,
    payment: autoCheque ? { ...invoice.payment, dueDate: cheques[0].dueDate } : invoice.payment,
    filePayable: fixedPayable,
    currencyNote: invoice.currencyNote ?? '',
    fileWarnings: invoice.warnings ?? [],
    chequesEdited: !autoCheque && (cheques.length > 0 || invoice.payment.type !== 'cash'),
    cheques: cheques.map((c) => ({ key: newKey(), id: c.id, amount: c.amount, dueDate: c.dueDate, status: c.status })),
    items: items.map((row) => ({
      ...emptyItem(),
      name: row.name,
      irc: row.irc ?? '',
      genericCode: row.genericCode ?? '',
      form: row.form ?? '',
      strength: row.strength ?? '',
      batch: row.batch ?? '',
      expiry: row.expiry ?? '',
      qty: row.quantity,
      bonus: row.bonus,
      unitPrice: row.unitPrice,
      consumerPrice: row.consumerPrice,
      discountPercent: row.discount,
      discountAmount: row.discountAmount,
      tax: row.tax,
      drugId: row.drugId,
      matchedBy: row.drugId === null ? null : 'manual',
    })),
  };
}

// ---------- سود اقلام ----------

export interface PurchasedItem {
  key: string;
  item: InvoiceItem;
  invoice: Invoice;
  distributor: string;
  purchases: number;
}

/** آخرین خرید هر قلم. قلم با داروی بانک شناخته می‌شود و اگر وصل نشده باشد با نام روی فاکتور. */
export function latestPurchases(items: InvoiceItem[], invoices: Invoice[], distributors: Distributor[]): PurchasedItem[] {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const nameById = new Map(distributors.map((d) => [d.id, d.name]));
  const latest = new Map<string, PurchasedItem>();
  for (const item of items) {
    const invoice = invoiceById.get(item.invoiceId);
    if (!invoice) continue;
    const key = item.drugId !== null ? `d${item.drugId}` : `n${matchKey(item.name)}`;
    const current = latest.get(key);
    const purchases = (current?.purchases ?? 0) + 1;
    if (!current || invoice.date > current.invoice.date || (invoice.date === current.invoice.date && item.id > current.item.id)) {
      latest.set(key, { key, item, invoice, distributor: nameById.get(invoice.distributorId) ?? '—', purchases });
    } else {
      current.purchases = purchases;
    }
  }
  return [...latest.values()];
}
