import 'fake-indexeddb/auto';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureDefaults } from '../src/lib/db';
import { checkBackup, exportAll, restoreAll } from '../src/lib/backup';
import { addSamples, clearSamples, countSamples } from '../src/lib/sample';
import {
  commitRows, detectHeaderRow, guessColumns, headersOf, mapRows, readWorkbook, SLOT_DEFS,
} from '../src/lib/import';

const slot = (id: string) => SLOT_DEFS.find((s) => s.id === id)!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureDefaults();
});

describe('شروع', () => {
  it('تنظیمات و بیمه‌ها یک بار ساخته می‌شوند', async () => {
    await ensureDefaults();
    expect(await db.insurers.count()).toBe(3);
    expect((await db.settings.get('main'))?.monthlyRate).toBe(0.03);
  });
});

describe('داده‌های نمونه', () => {
  it('فقط ردیف‌های نمونه پاک می‌شوند', async () => {
    await addSamples();
    await addSamples();
    expect(await countSamples()).toBe(18);
    await clearSamples();
    expect(await countSamples()).toBe(0);
    expect(await db.insurers.count()).toBe(3);
  });
});

describe('پشتیبان', () => {
  it('خروجی و بازیابی کامل', async () => {
    await addSamples();
    const text = JSON.stringify(await exportAll());
    await db.cheques.clear();
    await db.settings.update('main', { monthlyRate: 0.09 });
    const check = checkBackup(text);
    expect(check.ok).toBe(true);
    if (check.ok) await restoreAll(check.backup);
    expect(await db.cheques.count()).toBe(3);
    expect((await db.settings.get('main'))?.monthlyRate).toBe(0.03);
  });
  it('فایل نامعتبر رد می‌شود و چیزی تغییر نمی‌کند', async () => {
    expect(checkBackup('not json').ok).toBe(false);
    expect(checkBackup('{"app":"x"}').ok).toBe(false);
    expect(checkBackup('{"app":"pharmacy-finance","schemaVersion":99,"tables":{}}').ok).toBe(false);
    expect(checkBackup('{"app":"pharmacy-finance","schemaVersion":1,"tables":{"drugs":[]}}').ok).toBe(false);
    expect(await db.insurers.count()).toBe(3);
  });
});

describe('ورود فایل', () => {
  const sheet = [
    ['فهرست هزینه‌های داروخانه'],
    [],
    ['رديف', 'عنوان', 'مبلغ ماهانه', 'از ماه'],
    [1, 'برق', '۱٬۲۰۰٬۰۰۰', '1405/8'],
    [2, 'حقوق', 50000000, '۱۴۰۵/۰۹'],
    [3, '', 100, '1405/8'],
    [4, 'آب', 'نامعلوم', '1405/8'],
  ];
  const buffer = () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), 'برگه۱');
    return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  };

  it('اکسل با عنوان بالای جدول، نگاشت و ردیف‌های خراب', async () => {
    const [data] = readWorkbook(buffer(), 'a.xlsx');
    const header = detectHeaderRow(data.rows);
    expect(data.rows[header]).toContain('عنوان');
    const headers = headersOf(data.rows, header);
    const fields = slot('fixedCosts').fields;
    const columns = guessColumns(headers, fields);
    expect(columns).toMatchObject({ title: 1, amount: 2, startMonth: 3 });
    const out = mapRows(data.rows, header, fields, { columns, moneyUnit: 'toman' });
    expect(out.records).toHaveLength(2);
    expect(out.records[0]).toMatchObject({ title: 'برق', amount: 12_000_000, startMonth: '1405-08' });
    expect(out.issues).toHaveLength(2);

    const first = await commitRows(slot('fixedCosts'), out.records);
    expect(first).toEqual({ added: 2, updated: 0 });
    const second = await commitRows(slot('fixedCosts'), [{ title: 'برق', amount: 1 }]);
    expect(second).toEqual({ added: 0, updated: 1 });
    expect(await db.fixedCosts.count()).toBe(2);
  });

  it('CSV با کدگذاری ویندوز-۱۲۵۶ و قالب ذخیره‌شده', () => {
    const bytes = new Uint8Array([0xe4, 0xc7, 0xe3, 0x2c, 0x61, 0x0a, 0xc8, 0x2c, 0x62]); // نام,a
    const [data] = readWorkbook(bytes.buffer, 'x.csv');
    expect(data.rows[0][0]).toBe('نام');
    expect(guessColumns(['نام', 'a'], slot('insurers').fields)).toEqual({ name: 0 });
  });

  it('بیمه با سهم و کسورات درصدی', async () => {
    const fields = slot('insurers').fields;
    const rows = [['نام بیمه', 'تاخیر', 'کسورات'], ['سلامت', 9, '5%'], ['بیمهٔ تازه', '۴', 3]];
    const headers = headersOf(rows, 0);
    const columns = guessColumns(headers, fields);
    const out = mapRows(rows, 0, fields, { columns, moneyUnit: 'rial' });
    await commitRows(slot('insurers'), out.records);
    const all = await db.insurers.toArray();
    expect(all).toHaveLength(4);
    expect(all.find((i) => i.name === 'سلامت')).toMatchObject({ delayMonths: 9, deductionRate: 0.05, defaultShare: 0.7 });
    expect(all.find((i) => i.name === 'بیمهٔ تازه')).toMatchObject({ active: true, delayMonths: 4, deductionRate: 0.03 });
  });
});
