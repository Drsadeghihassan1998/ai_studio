import * as XLSX from 'xlsx';
import type { Cheque, Distributor, Drug, Invoice, InvoiceItem } from './db';
import { fullDrugDose, fullDrugName } from './drugname';
import { faDate } from './format';
import { draftTotal, lineOf, payableOf, type DraftInvoice } from './invoice';
import { PAYMENT_TYPE_LABELS } from './invoiceExportLabels';

function safeFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 60) || 'invoice';
}

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** خروجی اکسل یک فاکتور ثبت‌شده (شامل برگهٔ اقلام فاکتور و برگهٔ مشخصات و چک‌ها) */
export function exportInvoiceToExcel(params: {
  invoice: Invoice;
  items: InvoiceItem[];
  distributorName: string;
  drugsMap: Map<number, Drug>;
  cheques: Cheque[];
}) {
  const { invoice, items, distributorName, drugsMap, cheques } = params;
  const wb = XLSX.utils.book_new();

  let sumQty = 0;
  let sumBonus = 0;
  let sumGross = 0;
  let sumDiscount = 0;
  let sumTax = 0;
  let sumPayable = 0;

  const itemRows = items.map((item, idx) => {
    const matchedDrug = item.drugId !== null ? drugsMap.get(item.drugId) : undefined;
    const gross = item.quantity * item.unitPrice;
    const discountAmt = item.discountAmount > 0 ? item.discountAmount : Math.round(gross * item.discount);
    const rowTotal = item.total;

    sumQty += item.quantity;
    sumBonus += item.bonus;
    sumGross += gross;
    sumDiscount += discountAmt;
    sumTax += item.tax;
    sumPayable += rowTotal;

    return {
      'ردیف': idx + 1,
      'نام دارو در فاکتور': item.name,
      'نام ژنریک در بانک دارو': matchedDrug ? `${fullDrugName(matchedDrug)} ${fullDrugDose(matchedDrug)}`.trim() : 'وصل‌نشده',
      'کد IRC': item.irc || '—',
      'کد ژنریک': item.genericCode || matchedDrug?.genericCode || '—',
      'شکل دارویی': item.form || matchedDrug?.form || '—',
      'دوز': item.strength || (matchedDrug ? fullDrugDose(matchedDrug) : '') || '—',
      'سری ساخت (بچ)': item.batch || '—',
      'تاریخ انقضا': item.expiry ? faDate(item.expiry) : '—',
      'تعداد خرید': item.quantity,
      'تعداد جایزه (آفر)': item.bonus,
      'کل تعداد دریافتی': item.quantity + item.bonus,
      'فی خرید واحد (ریال)': Math.round(item.unitPrice),
      'قیمت مصرف‌کننده (ریال)': Math.round(item.consumerPrice),
      'درصد تخفیف (٪)': Number((item.discount * 100).toFixed(2)),
      'مبلغ تخفیف (ریال)': Math.round(discountAmt),
      'مالیات و عوارض (ریال)': Math.round(item.tax),
      'جمع قابل پرداخت سطر (ریال)': Math.round(rowTotal),
      'قیمت تمام‌شده هر واحد با آفر (ریال)': Math.round(item.effectiveUnitCost),
    };
  });

  itemRows.push({
    'ردیف': itemRows.length + 1,
    'نام دارو در فاکتور': 'جمع کل فاکتور',
    'نام ژنریک در بانک دارو': '',
    'کد IRC': '',
    'کد ژنریک': '',
    'شکل دارویی': '',
    'دوز': '',
    'سری ساخت (بچ)': '',
    'تاریخ انقضا': '',
    'تعداد خرید': sumQty,
    'تعداد جایزه (آفر)': sumBonus,
    'کل تعداد دریافتی': sumQty + sumBonus,
    'فی خرید واحد (ریال)': 0,
    'قیمت مصرف‌کننده (ریال)': 0,
    'درصد تخفیف (٪)': 0,
    'مبلغ تخفیف (ریال)': Math.round(sumDiscount),
    'مالیات و عوارض (ریال)': Math.round(sumTax),
    'جمع قابل پرداخت سطر (ریال)': Math.round(invoice.payable || sumPayable),
    'قیمت تمام‌شده هر واحد با آفر (ریال)': 0,
  });

  const wsItems = XLSX.utils.json_to_sheet(itemRows);
  XLSX.utils.book_append_sheet(wb, wsItems, 'اقلام فاکتور');

  const metaRows = [
    { 'عنوان': 'شرکت پخش', 'مقدار': distributorName },
    { 'عنوان': 'شماره فاکتور', 'مقدار': invoice.number || '—' },
    { 'عنوان': 'تاریخ فاکتور', 'مقدار': faDate(invoice.date) },
    { 'عنوان': 'نوع پرداخت', 'مقدار': PAYMENT_TYPE_LABELS[invoice.payment.type] ?? invoice.payment.type },
    { 'عنوان': 'مدت چک (ماه)', 'مقدار': invoice.payment.chequeMonths ?? '—' },
    { 'عنوان': 'تعداد اقلام', 'مقدار': items.length },
    { 'عنوان': 'جمع ناخالص (ریال)', 'مقدار': Math.round(sumGross) },
    { 'عنوان': 'جمع تخفیف (ریال)', 'مقدار': Math.round(sumDiscount) },
    { 'عنوان': 'جمع مالیات (ریال)', 'مقدار': Math.round(sumTax) },
    { 'عنوان': 'مبلغ قابل پرداخت نهایی (ریال)', 'مقدار': Math.round(invoice.payable) },
  ];
  const wsMeta = XLSX.utils.json_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'مشخصات فاکتور');

  if (cheques.length > 0) {
    const chequeRows = cheques.map((c, idx) => ({
      'ردیف': idx + 1,
      'مبلغ چک (ریال)': Math.round(c.amount),
      'تاریخ سررسید': faDate(c.dueDate),
      'وضعیت': c.status === 'paid' ? 'پاس‌شده' : 'در انتظار پاس',
    }));
    const wsCheques = XLSX.utils.json_to_sheet(chequeRows);
    XLSX.utils.book_append_sheet(wb, wsCheques, 'چک‌های فاکتور');
  }

  const fileTitle = `فاکتور-${safeFileName(distributorName)}-${safeFileName(invoice.number || String(invoice.id))}-${faDate(invoice.date).replace(/\//g, '-')}`;
  downloadWorkbook(wb, fileTitle);
}

/** خروجی اکسل از پیش‌نویس فاکتور در حال ویرایش */
export function exportDraftInvoiceToExcel(draft: DraftInvoice, drugsMap: Map<number, Drug>) {
  const wb = XLSX.utils.book_new();
  const rows = draft.items.map((item, idx) => {
    const matchedDrug = item.drugId !== null ? drugsMap.get(item.drugId) : undefined;
    const fig = lineOf(item);
    return {
      'ردیف': idx + 1,
      'نام دارو در فاکتور': item.name,
      'نام ژنریک در بانک دارو': matchedDrug ? `${fullDrugName(matchedDrug)} ${fullDrugDose(matchedDrug)}`.trim() : 'وصل‌نشده',
      'کد IRC': item.irc || '—',
      'کد ژنریک': item.genericCode || '—',
      'شکل دارویی': item.form || '—',
      'دوز': item.strength || '—',
      'سری ساخت (بچ)': item.batch || '—',
      'تاریخ انقضا': item.expiry || '—',
      'تعداد خرید': item.qty,
      'تعداد جایزه (آفر)': item.bonus,
      'کل تعداد دریافتی': item.qty + item.bonus,
      'فی خرید واحد (ریال)': Math.round(item.unitPrice),
      'قیمت مصرف‌کننده (ریال)': Math.round(item.consumerPrice),
      'درصد تخفیف (٪)': Number((item.discountPercent * 100).toFixed(2)),
      'مبلغ تخفیف (ریال)': Math.round(fig.discount),
      'مالیات و عوارض (ریال)': Math.round(item.tax),
      'جمع سطر (ریال)': Math.round(item.fileTotal ?? fig.paid),
      'قیمت تمام‌شده هر واحد (ریال)': Math.round(fig.unitCost),
    };
  });

  const wsItems = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, wsItems, 'اقلام فاکتور');

  const metaRows = [
    { 'عنوان': 'شرکت پخش', 'مقدار': draft.distributor || '—' },
    { 'عنوان': 'شماره فاکتور', 'مقدار': draft.number || '—' },
    { 'عنوان': 'تاریخ فاکتور', 'مقدار': draft.date ? faDate(draft.date) : '—' },
    { 'عنوان': 'نوع پرداخت', 'مقدار': PAYMENT_TYPE_LABELS[draft.payment.type] ?? draft.payment.type },
    { 'عنوان': 'جمع سطرها (ریال)', 'مقدار': Math.round(draftTotal(draft)) },
    { 'عنوان': 'قابل پرداخت نهایی (ریال)', 'مقدار': Math.round(payableOf(draft)) },
  ];
  const wsMeta = XLSX.utils.json_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'مشخصات فاکتور');

  const fileTitle = `فاکتور-${safeFileName(draft.distributor || 'جدید')}-${safeFileName(draft.number || 'پیش‌نویس')}`;
  downloadWorkbook(wb, fileTitle);
}

/** خروجی اکسل کامل بایگانی یک شرکت پخش (فاکتورها + ریز اقلام خریداری‌شده + چک‌ها) */
export function exportDistributorArchiveToExcel(params: {
  distributor: Distributor;
  invoices: Invoice[];
  items: InvoiceItem[];
  cheques: Cheque[];
  drugsMap: Map<number, Drug>;
}) {
  const { distributor, invoices, items, cheques, drugsMap } = params;
  const wb = XLSX.utils.book_new();
  const invMap = new Map(invoices.map((i) => [i.id, i]));

  const invoiceRows = invoices.map((inv, idx) => {
    const invItems = items.filter((it) => it.invoiceId === inv.id);
    const totalBonus = invItems.reduce((s, it) => s + it.bonus, 0);
    return {
      'ردیف': idx + 1,
      'شماره فاکتور': inv.number || '—',
      'تاریخ فاکتور': faDate(inv.date),
      'تعداد اقلام': invItems.length,
      'مجموع تعداد آفر/جایزه': totalBonus,
      'نوع پرداخت': PAYMENT_TYPE_LABELS[inv.payment.type] ?? inv.payment.type,
      'مهلت چک (ماه)': inv.payment.chequeMonths ?? '—',
      'مبلغ قابل پرداخت (ریال)': Math.round(inv.payable),
    };
  });
  const wsInvoices = XLSX.utils.json_to_sheet(invoiceRows.length ? invoiceRows : [{ 'پیام': 'فاکتوری ثبت نشده است' }]);
  XLSX.utils.book_append_sheet(wb, wsInvoices, 'فهرست فاکتورها');

  const itemRows = items.map((item, idx) => {
    const inv = invMap.get(item.invoiceId);
    const matchedDrug = item.drugId !== null ? drugsMap.get(item.drugId) : undefined;
    return {
      'ردیف': idx + 1,
      'شماره فاکتور': inv?.number || '—',
      'تاریخ خرید': inv ? faDate(inv.date) : '—',
      'نام دارو در فاکتور': item.name,
      'نام ژنریک بانک دارو': matchedDrug ? `${fullDrugName(matchedDrug)} ${fullDrugDose(matchedDrug)}`.trim() : 'وصل‌نشده',
      'تعداد خرید': item.quantity,
      'تعداد جایزه (آفر)': item.bonus,
      'فی خرید واحد (ریال)': Math.round(item.unitPrice),
      'قیمت مصرف‌کننده (ریال)': Math.round(item.consumerPrice),
      'قیمت تمام‌شده هر واحد (ریال)': Math.round(item.effectiveUnitCost),
      'درصد تخفیف (٪)': Number((item.discount * 100).toFixed(2)),
      'مالیات (ریال)': Math.round(item.tax),
      'جمع ردیف (ریال)': Math.round(item.total),
      'تاریخ انقضا': item.expiry ? faDate(item.expiry) : '—',
      'سری ساخت': item.batch || '—',
    };
  });
  const wsItems = XLSX.utils.json_to_sheet(itemRows.length ? itemRows : [{ 'پیام': 'قلمی ثبت نشده است' }]);
  XLSX.utils.book_append_sheet(wb, wsItems, 'ریز اقلام خریداری‌شده');

  const chequeRows = cheques.map((c, idx) => {
    const inv = c.invoiceId ? invMap.get(c.invoiceId) : undefined;
    return {
      'ردیف': idx + 1,
      'شماره فاکتور': inv?.number || '—',
      'تاریخ فاکتور': inv ? faDate(inv.date) : '—',
      'مبلغ چک (ریال)': Math.round(c.amount),
      'تاریخ سررسید': faDate(c.dueDate),
      'وضعیت': c.status === 'paid' ? 'پاس‌شده' : 'در انتظار پاس',
    };
  });
  const wsCheques = XLSX.utils.json_to_sheet(chequeRows.length ? chequeRows : [{ 'پیام': 'چکی ثبت نشده است' }]);
  XLSX.utils.book_append_sheet(wb, wsCheques, 'چک‌های شرکت پخش');

  downloadWorkbook(wb, `بایگانی-${safeFileName(distributor.name)}`);
}
