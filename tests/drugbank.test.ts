import 'fake-indexeddb/auto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { coverageShares } from '../src/lib/calc';
import { db, ensureDefaults, type Insurer } from '../src/lib/db';
import { doseKey, formFamily, nameSimilarity } from '../src/lib/drugname';
import { applyList, insurerColumn, mergeDrugs, saveManualDrug, type ListRow } from '../src/lib/drugbank';
import { balanceCheck, columnWarnings, detectMapping, mapRows, readWorkbook, SLOT_DEFS, UnreadableFile } from '../src/lib/import';

const coverage = SLOT_DEFS.find((s) => s.id === 'coverage')!;

const insurerByName = async (name: string) => (await db.insurers.toArray()).find((i) => i.name.includes(name))!;

async function column(drugId: number, insurer: Insurer) {
  const drug = (await db.drugs.get(drugId))!;
  const fresh = (await db.insurers.get(insurer.id))!;
  const cov = await db.coverage.where('[drugId+insurerId]').equals([drugId, insurer.id]).first();
  const list = fresh.priceListId ? await db.priceLists.get(fresh.priceListId) : undefined;
  return insurerColumn(drug, fresh, cov, list);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureDefaults();
});

describe('سهم بیمه طبق مثال‌های شما', () => {
  it('مبلغ مستقیم سلامت', () => {
    const r = coverageShares({ price: 27000, shareBase: 'price', insurerAmount: 19911 });
    expect(r).toEqual({ insurer: 19911, patient: 7089 });
  });
  it('سه پایهٔ وراپامیل تأمین', () => {
    const v = { price: 21000, subsidy: 1563, shareRate: 0.7, coveredPrice: 19437 };
    expect(coverageShares({ ...v, shareBase: 'price' }).insurer).toBeCloseTo(14700);
    expect(coverageShares({ ...v, shareBase: 'netOfSubsidy' }).insurer).toBeCloseTo(13605.9);
    expect(coverageShares({ ...v, shareBase: 'netPlusSubsidy' }).insurer).toBeCloseTo(15168.9);
  });
  it('قیمت بالاتر از سقف تعهد', () => {
    const r = coverageShares({ price: 150000, coveredPrice: 120000, shareRate: 0.7, shareBase: 'coveredPrice' });
    expect(r.patient).toBeCloseTo(66000);
  });
});

describe('تحلیل نام', () => {
  it('شکل و دوز', () => {
    expect(formFamily('COATED  TAB')).toBe('قرص');
    expect(formFamily('CAPTOPRIL X')).toBe('سایر');
    expect(formFamily('VERAPAMIL 2.5 mg/1mL INJECTION PARENTERAL')).toBe('تزریقی');
    expect(doseKey('40 MG')).toBe(doseKey('40mg'));
  });
  it('شباهت نام', () => {
    expect(nameSimilarity('SULFSALAZINE', 'SULFASALAZINE 500 mg TABLET')).toBeGreaterThan(0.6);
    expect(nameSimilarity('COGRAFT®(TACROLIMUS )', 'TACROLIMUS 1 mg CAPSULE')).toBeGreaterThan(0.6);
    expect(nameSimilarity('VERAPAMIL  HCL', 'VERAPAMIL HYDROCHLORIDE 40 mg TABLET')).toBeGreaterThan(0.9);
    expect(nameSimilarity('ASPIRIN', 'METFORMIN')).toBeLessThan(0.6);
  });
});

describe('ادغام فهرست‌ها', () => {
  const salamat: ListRow = { brandCode: '01279', genericCode: '01279', name: 'VERAPAMIL  HCL', form: 'COATED  TAB', dose: '40 mg', price: 21000, insurerAmount: 15000 };
  const tamin: ListRow = { brandCode: '01279', name: 'VERAPAMIL HYDROCHLORIDE 40 mg TABLET ORAL', price: 21000, subsidy: 1563, shareRate: 0.7, status: 'است' };

  it('هم‌کد و هم‌نام یکی می‌شوند؛ ورود دوباره تکراری نمی‌سازد و تغییر قیمت ثبت می‌شود', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(s.id, [salamat], { fileName: 'a' });
    await applyList(t.id, [tamin], { fileName: 'b' });
    expect(await db.drugs.count()).toBe(1);
    expect(await db.coverage.count()).toBe(2);
    const second = await applyList(t.id, [{ ...tamin, price: 25000 }], { fileName: 'b2' });
    expect(second).toMatchObject({ added: 0, updated: 1, priceChanged: 1, newDrugs: 0 });
    expect(await db.drugs.count()).toBe(1);
    const history = await db.priceHistory.toArray();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ oldPrice: 21000, newPrice: 25000 });
  });

  it('هم‌کد با نام متفاوت به «نیاز به بررسی» می‌رود و بعد قابل ادغام است', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(s.id, [salamat], { fileName: 'a' });
    const r = await applyList(t.id, [{ ...tamin, name: 'ZZZQQQ 40 mg TABLET' }], { fileName: 'b' });
    expect(r.review).toBe(1);
    expect(await db.drugs.count()).toBe(2);
    const item = (await db.reviewItems.toArray())[0];
    expect(await mergeDrugs(item.drugId, item.candidateId)).toBe(true);
    expect(await db.drugs.count()).toBe(1);
    expect((await db.drugs.toArray())[0].names).toHaveLength(2);
    expect(await db.coverage.where('drugId').equals(item.candidateId).count()).toBe(2);
  });

  it('قیمت بیش از ۲ برابر متفاوت: جدا و نیاز به بررسی؛ «یکی هستند» ماندگار است', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(s.id, [salamat], { fileName: 'a' });
    const far = { ...tamin, price: 90000 };
    const r = await applyList(t.id, [far], { fileName: 'b' });
    expect(r.review).toBe(1);
    expect(await db.drugs.count()).toBe(2);
    const item = (await db.reviewItems.toArray())[0];
    expect(item.reason).toContain('۲ برابر');
    expect(await mergeDrugs(item.drugId, item.candidateId)).toBe(true);
    const again = await applyList(t.id, [far], { fileName: 'b2' });
    expect(again).toMatchObject({ review: 0, newDrugs: 0 });
    expect(await db.drugs.count()).toBe(1);
  });

  it('ادغام قدیمی با قیمت خیلی متفاوت در ورود دوباره جدا می‌شود', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(s.id, [salamat], { fileName: 'a' });
    await applyList(t.id, [tamin], { fileName: 'b' });
    expect(await db.drugs.count()).toBe(1);
    const r = await applyList(t.id, [{ ...tamin, price: 90000 }], { fileName: 'b2' });
    expect(r.review).toBe(1);
    expect(await db.drugs.count()).toBe(2);
    expect(await db.coverage.count()).toBe(2);
    const prices = (await db.drugs.toArray()).map((d) => d.price).sort((a, b) => a - b);
    expect(prices).toEqual([21000, 90000]);
  });

  it('قیمت بانک به ترتیب ورود بستگی ندارد و جای‌نگهدار قیمت نیست', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(t.id, [{ ...tamin, price: 30000 }], { fileName: 'b' });
    await applyList(s.id, [{ ...salamat, price: 25000 }], { fileName: 'a' });
    expect((await db.drugs.toArray())[0].price).toBe(30000);
    await applyList(t.id, [{ ...tamin, price: 2 }], { fileName: 'c' });
    expect((await db.drugs.toArray())[0].price).toBe(25000);
    const drug = (await db.drugs.toArray())[0];
    expect((await column(drug.id, t)).price).toBe(25000);
  });

  it('بدون کد: نام + شکل + دوز', async () => {
    const s = await insurerByName('سلامت');
    const t = await insurerByName('تأمین');
    await applyList(s.id, [{ name: 'LOSARTAN', form: 'TAB', dose: '25 mg', price: 100 }], { fileName: 'a' });
    await applyList(t.id, [{ name: 'LOSARTAN 25 mg TABLET ORAL', price: 100 }], { fileName: 'b' });
    expect(await db.drugs.count()).toBe(1);
  });

  it('افتادن از فهرست جدید علامت می‌خورد', async () => {
    const s = await insurerByName('سلامت');
    await applyList(s.id, [salamat, { ...salamat, brandCode: '9', genericCode: '9', name: 'OTHER' }], { fileName: 'a' });
    const r = await applyList(s.id, [salamat], { fileName: 'a2' });
    expect(r.stale).toBe(1);
  });
});

describe('ستون بیمه و داروی دستی', () => {
  it('سهم پیش‌فرض، آزاد، سقف تعهد', async () => {
    const armed = await insurerByName('نیروهای مسلح');
    const salamat = await insurerByName('سلامت');
    const plain = await saveManualDrug({ name: 'تست', form: '', dose: '', code: '', price: 40000, otc: false, insurerId: null, coveredPrice: 0, shareRate: 0 });
    expect((await column(plain, armed)).share).toBeCloseTo(28000);
    const free = await saveManualDrug({ name: 'آزاد', form: '', dose: '', code: '', price: 50000, otc: true, insurerId: null, coveredPrice: 0, shareRate: 0 });
    expect((await column(free, armed)).patient).toBe(50000);
    const capped = await saveManualDrug({ name: 'سقف', form: '', dose: '', code: '', price: 150000, otc: false, insurerId: salamat.id, coveredPrice: 120000, shareRate: 0.7 });
    expect((await column(capped, salamat)).patient).toBeCloseTo(66000);
  });
});

describe('خواندن فایل', () => {
  it('xls خراب پیام روشن می‌دهد', () => {
    const junk = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]).buffer;
    expect(() => readWorkbook(junk, 'a.xls')).toThrow(UnreadableFile);
  });
});

// تست با فایل‌های واقعی؛ فقط وقتی فایل‌ها روی همین کامپیوتر باشند اجرا می‌شود.
const dir = `${process.env.USERPROFILE}/Downloads/`;
const find = (re: RegExp) => (existsSync(dir) ? readdirSync(dir).find((f) => re.test(f)) : undefined);
const salamatFile = find(/بیمه سلامت\.xls$/);
const taminFile = find(/تامین اجتماعی\.xls$/);

describe.skipIf(!salamatFile || !taminFile)('فایل‌های واقعی', () => {
  const load = (name: string) => {
    const bytes = readFileSync(dir + name);
    const [sheet] = readWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer, name);
    const detected = detectMapping(coverage, sheet.rows);
    return { sheet, detected, mapped: mapRows(sheet.rows, detected.headerRow, coverage.fields, detected) };
  };

  it('سلامت و تأمین', async () => {
    const s = load(salamatFile!);
    const t = load(taminFile!);
    expect(s.detected.source).toBe('salamat');
    expect(t.detected.source).toBe('tamin');
    console.log('salamat', s.mapped.records.length, 'rejected', s.mapped.issues.length, s.mapped.issues.slice(0, 3));
    console.log('tamin', t.mapped.records.length, 'rejected', t.mapped.issues.length, t.mapped.issues.slice(0, 3));
    expect(columnWarnings(s.sheet.rows, s.detected.headerRow, coverage.fields, s.detected)).toEqual({});
    expect(columnWarnings(t.sheet.rows, t.detected.headerRow, coverage.fields, t.detected)).toEqual({});
    expect(balanceCheck(t.mapped.records)).toEqual({ ok: 2599, total: 2599 });

    const salamat = await insurerByName('سلامت');
    const tamin = await insurerByName('تأمین');
    const started = Date.now();
    const r1 = await applyList(salamat.id, s.mapped.records as unknown as ListRow[], { fileName: 's' });
    const r2 = await applyList(tamin.id, t.mapped.records as unknown as ListRow[], { fileName: 't', shareBase: 'price' });
    console.log('salamat', r1, 'tamin', r2, 'ms', Date.now() - started, 'drugs', await db.drugs.count());
    const reasons: Record<string, number> = {};
    for (const item of await db.reviewItems.toArray()) reasons[item.reason.replace(/\d+/g, 'N')] = (reasons[item.reason.replace(/\d+/g, 'N')] ?? 0) + 1;
    console.log(reasons);
    for (const item of (await db.reviewItems.toArray()).slice(0, 12)) {
      const [a, b] = [await db.drugs.get(item.drugId), await db.drugs.get(item.candidateId)];
      console.log(item.reason, '|', a?.names[0].slice(0, 40), '|', b?.names[0].slice(0, 40));
    }

    const all = await db.drugs.toArray();
    const para = all.find((d) => d.codes.includes('02012'))!;
    const c = await column(para.id, salamat);
    expect(c).toMatchObject({ price: 27000, share: 19911, patient: 7089 });
    const multi = await db.coverage.filter((c) => Boolean(c.shareOptions)).toArray();
    console.log('multi-share', multi.length, multi[0]?.shareOptions, multi[0]?.insurerAmount);
    expect(multi.every((c) => c.insurerAmount === Math.min(...c.shareOptions!))).toBe(true);
    const vera = all.find((d) => d.codes.includes('01279'))!;
    expect(vera.searchText).toContain('verapamil');
    console.log(vera.names, vera.formFamily, vera.dose);
    expect((await column(vera.id, tamin)).share).toBeCloseTo(14700);

    const again = await applyList(tamin.id, t.mapped.records as unknown as ListRow[], { fileName: 't' });
    expect(again).toMatchObject({ added: 0, newDrugs: 0, priceChanged: 0, review: 0, stale: 0 });
    const fams: Record<string, number> = {};
    for (const d of all) fams[d.formFamily] = (fams[d.formFamily] ?? 0) + 1;
    console.log(fams);
  }, 60000);
});
