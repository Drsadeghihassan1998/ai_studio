import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { lineFigures, marginHistogram, realProfit } from '../src/lib/calc';
import { db, ensureDefaults } from '../src/lib/db';
import { saveManualDrug } from '../src/lib/drugbank';
import {
  buildMatchIndex, deleteInvoice, draftWarnings, emptyDraft, emptyItem, latestPurchases, loadDraft, matchItem, parseInvoiceJson,
  planCheques, saveInvoice, saveProblems,
} from '../src/lib/invoice';
import { INVOICE_PROMPT } from '../src/lib/invoicePrompt';
import { addJalaliMonths, parseJalaliDate } from '../src/lib/jalali';

const line = (o: Partial<Parameters<typeof lineFigures>[0]>) =>
  lineFigures({ qty: 10, bonus: 0, unitPrice: 80000, discountPercent: 0, discountAmount: 0, tax: 0, consumerPrice: 100000, ...o });

describe('برگهٔ تست مرحلهٔ ۳', () => {
  it('خرید ساده', () => {
    const f = line({});
    expect(f.unitCost).toBe(80000);
    expect(f.marginOnSale).toBeCloseTo(0.2);
    expect(f.marginOnCost).toBeCloseTo(0.25);
  });
  it('آفر ۱۰+۲', () => {
    const f = line({ bonus: 2 });
    expect(f.unitCost).toBeCloseTo(66666.6667);
    expect(f.marginOnSale).toBeCloseTo(0.33333);
    expect(f.marginOnCost).toBeCloseTo(0.5);
  });
  it('آفر با ۱۲٪ تخفیف', () => {
    const f = line({ qty: 100, bonus: 20, unitPrice: 82000, discountPercent: 0.12 });
    expect(f.unitCost).toBeCloseTo(60133.3333);
    expect(f.marginOnSale).toBeCloseTo(0.398667);
    expect(f.marginOnCost).toBeCloseTo(0.662971);
  });
  it('مالیات کل سطر', () => {
    const f = line({ unitPrice: 50000, tax: 50000, consumerPrice: 70000 });
    expect(f.unitCost).toBe(55000);
    expect(f.marginOnSale).toBeCloseTo(0.214286);
    expect(f.marginOnCost).toBeCloseTo(0.272727);
  });
  it('سود واقعی با تأخیر بیمه', () => {
    const r = realProfit({ patient: 30000, insurer: 70000, deductionRate: 0.03, delayMonths: 9, r: 0.03, unitCost: 80000 });
    expect(r.nominal).toBeCloseTo(17900);
    expect(r.real).toBeCloseTo(2039.696, 2);
  });
  it('مبلغ تخفیف بر درصد مقدم است و دوبار کم نمی‌شود', () => {
    expect(line({ discountPercent: 0.1, discountAmount: 50000 }).net).toBe(750000);
  });
  it('توزیع سود', () => {
    const bins = marginHistogram([-0.1, 0, 0.049, 0.05, 0.2, 0.39, 0.4, 0.9]);
    expect(bins).toHaveLength(10);
    expect(bins[0].count).toBe(1);
    expect(bins[1].count).toBe(2);
    expect(bins[2].count).toBe(1);
    expect(bins[9].count).toBe(2);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(8);
  });
});

describe('تاریخ', () => {
  it('افزودن ماه شمسی', () => {
    const d = parseJalaliDate('۱۴۰۵/۰۸/۱۵')!;
    expect(d).toBe('2026-11-06');
    expect(addJalaliMonths(d, 3)).toBe(parseJalaliDate('1405/11/15'));
    expect(addJalaliMonths(d, 6)).toBe(parseJalaliDate('1406/02/15'));
    expect(addJalaliMonths(parseJalaliDate('1405/06/31')!, 1)).toBe(parseJalaliDate('1405/07/30'));
    expect(parseJalaliDate('1405/13/01')).toBeNull();
    expect(parseJalaliDate('1405/07/31')).toBeNull();
  });
});

const sample = {
  distributor: 'پخش البرز', invoice_no: '1234', invoice_date: '1405/08/10',
  payment: { type: 'cheque', cheque_months: 3, due_date: null, notes: '' },
  items: [{ row: 1, name: 'اسویکس', irc: null, generic_code: null, form: null, strength: null, batch: 'B1', expiry: '1407/01/01', qty: 10, bonus_qty: 2, unit_price: 80000, consumer_price: 100000, discount_percent: 0, discount_amount: 0, tax_amount: 0, line_total: 800000 }],
  totals: { gross: 800000, discount: 0, tax: 0, payable: 800000 },
  currency_note: '', warnings: ['مهر روی فاکتور ناخواناست'],
};

describe('JSON', () => {
  it('خطاهای روشن', () => {
    const bad = (t: string) => {
      const r = parseInvoiceJson(t);
      return r.ok ? [] : r.errors;
    };
    expect(bad('')[0]).toContain('خالی');
    expect(bad('{ناقص')[0]).toContain('معتبر نیست');
    expect(bad('{"a":1}')[0]).toContain('items');
    expect(bad('{"items":[]}')[0]).toContain('سطری');
    expect(bad('{"items":[{"name":"x","qty":"چند","unit_price":1}]}')[0]).toContain('«تعداد» عدد نیست');
    expect(bad('{"items":[{"name":"x","qty":-1,"unit_price":1}]}')[0]).toContain('منفی');
  });
  it('خروجی داخل ``` و با ارقام فارسی و null', () => {
    const copy = structuredClone(sample) as never as { items: Record<string, unknown>[] };
    copy.items[0].qty = '۱۰';
    copy.items[0].unit_price = null;
    const r = parseInvoiceJson('بفرمایید:\n```json\n' + JSON.stringify(copy) + '\n```');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.items[0].qty).toBe(10);
    expect(r.draft.items[0].unreadable).toContain('فی');
    expect(r.draft.fileWarnings).toContain('مهر روی فاکتور ناخواناست');
  });
  it('پرامپت عیناً در برنامه است', () => {
    expect(INVOICE_PROMPT.startsWith('فایل پیوست، فاکتور خرید یک داروخانه')).toBe(true);
    expect(INVOICE_PROMPT).toContain('"tax_amount": 0, "line_total": 0}]');
    expect(INVOICE_PROMPT.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('چک', () => {
  it('شرایط پرداخت', () => {
    const r = parseInvoiceJson(JSON.stringify(sample));
    if (!r.ok) throw new Error();
    const [c] = planCheques(r.draft);
    expect(c.amount).toBe(800000);
    expect(c.dueDate).toBe(parseJalaliDate('1405/11/10'));
    expect(planCheques({ ...r.draft, payment: { ...r.draft.payment, type: 'cash' } })).toEqual([]);
    const fixed = planCheques({ ...r.draft, payment: { ...r.draft.payment, dueDate: parseJalaliDate('1405/10/01') } });
    expect(fixed[0].dueDate).toBe(parseJalaliDate('1405/10/01'));
  });
});

describe('ذخیره و تطبیق', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await ensureDefaults();
  });

  async function saved() {
    const drugId = await saveManualDrug({ name: 'ESOMEPRAZOLE', form: 'CAP', dose: '20 mg', code: '09999', price: 100000, otc: false, insurerId: null, coveredPrice: 0, shareRate: 0 });
    const r = parseInvoiceJson(JSON.stringify(sample));
    if (!r.ok) throw new Error();
    const draft = r.draft;
    draft.items[0] = { ...draft.items[0], drugId, matchedBy: 'confirmed' };
    draft.cheques = planCheques(draft);
    return { drugId, draft, id: await saveInvoice(draft) };
  }

  it('سطر، بچ، چک، شرکت و نام تجاری ذخیره می‌شوند', async () => {
    const { drugId, id } = await saved();
    expect(await db.invoiceItems.count()).toBe(1);
    const lot = (await db.inventoryLots.toArray())[0];
    expect(lot).toMatchObject({ batch: 'B1', remaining: 12, invoiceId: id });
    expect((await db.cheques.toArray())[0]).toMatchObject({ amount: 800000, status: 'pending', invoiceId: id });
    expect((await db.distributors.toArray())[0].name).toBe('پخش البرز');
    expect((await db.drugAliases.toArray())[0]).toMatchObject({ alias: 'اسویکس', drugId });
  });

  it('دفعهٔ بعد نام تأییدشده خودکار وصل می‌شود؛ کد هم همین‌طور', async () => {
    const { drugId } = await saved();
    const index = buildMatchIndex(await db.drugs.toArray(), await db.drugAliases.toArray());
    expect(matchItem({ ...emptyItem(), name: 'اسويكس' }, index)).toMatchObject({ drugId, matchedBy: 'alias' });
    expect(matchItem({ ...emptyItem(), name: 'x', irc: '09999' }, index)).toMatchObject({ drugId, matchedBy: 'code' });
    const near = matchItem({ ...emptyItem(), name: 'ESOMEPRAZOL 20 mg' }, index);
    expect(near.drugId).toBeNull();
    expect(near.suggestions[0].drugId).toBe(drugId);
  });

  it('ویرایش تکراری نمی‌سازد و حذف همه را پاک می‌کند', async () => {
    const { id } = await saved();
    const draft = await loadDraft(id);
    draft.items[0].qty = 20;
    await saveInvoice(draft);
    expect(await db.invoices.count()).toBe(1);
    expect(await db.invoiceItems.count()).toBe(1);
    expect((await db.inventoryLots.toArray())[0].remaining).toBe(22);
    expect(await db.cheques.count()).toBe(1);
    await deleteInvoice(id);
    expect(await db.invoiceItems.count()).toBe(0);
    expect(await db.inventoryLots.count()).toBe(0);
    expect(await db.cheques.count()).toBe(0);
  });

  it('ویرایش فاکتور جمع و چک را به‌روز می‌کند و سررسید می‌ماند', async () => {
    const { id } = await saved();
    const dueBefore = (await db.cheques.toArray())[0].dueDate;
    const draft = await loadDraft(id);
    draft.filePayable = null;
    draft.items[0].qty = 20;
    await saveInvoice(draft);
    expect((await db.invoices.get(id))!.payable).toBe(1600000);
    const [cheque] = await db.cheques.toArray();
    expect(cheque.amount).toBe(1600000);
    expect(cheque.dueDate).toBe(dueBefore);
  });

  it('چکی که دستی عوض شده، بعد از ویرایش حفظ می‌شود', async () => {
    const { id } = await saved();
    const [cheque] = await db.cheques.toArray();
    await db.cheques.update(cheque.id, { amount: 300000 });
    const draft = await loadDraft(id);
    expect(draft.chequesEdited).toBe(true);
    draft.items[0].qty = 20;
    await saveInvoice(draft);
    expect((await db.cheques.toArray())[0].amount).toBe(300000);
    expect((await db.invoices.get(id))!.payable).toBe(1600000);
  });

  it('جمع فایل که با سطرها فرق دارد نگه داشته می‌شود', async () => {
    const { draft, id } = await saved();
    await saveInvoice({ ...draft, id, filePayable: 900000 });
    expect((await loadDraft(id)).filePayable).toBe(900000);
  });

  it('هشدار قیمت و جمع', async () => {
    const { drugId, draft } = await saved();
    const drugs = new Map((await db.drugs.toArray()).map((d) => [d.id, d]));
    draft.items[0].consumerPrice = 120000;
    draft.filePayable = 900000;
    const text = draftWarnings(draft, drugs, new Map(), true).join(' | ');
    expect(text).toContain('با بانک دارو');
    expect(text).toContain('برابر نیست');
    expect(text).toContain('قبلاً ثبت');
    expect(drugId).toBeGreaterThan(0);
  });

  it('ذخیرهٔ ناقص مانع دارد', () => {
    expect(saveProblems(emptyDraft()).length).toBeGreaterThan(0);
  });

  it('آخرین خرید هر قلم', async () => {
    const { draft } = await saved();
    const second = structuredClone(draft);
    delete second.id;
    second.number = '2';
    second.date = parseJalaliDate('1405/08/20');
    second.items[0].unitPrice = 90000;
    await saveInvoice(second);
    const list = latestPurchases(await db.invoiceItems.toArray(), await db.invoices.toArray(), await db.distributors.toArray());
    expect(list).toHaveLength(1);
    expect(list[0].item.unitPrice).toBe(90000);
    expect(list[0].purchases).toBe(2);
  });
});
