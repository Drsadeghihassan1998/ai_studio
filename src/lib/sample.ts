import { addDays, currentMonthKey, todayISO } from './jalali';
import { lineFigures } from './calc';
import {
  completeDrug, db, type Cheque, type Distributor, type Doctor, type Drug, type FixedCost, type Insurer, type InventoryLot,
  type Invoice, type InvoiceItem,
} from './db';

// داده‌های نمونه برای تست. همهٔ عددها ساختگی‌اند و هر ردیف sample=true دارد.

const SAMPLE_TABLES = [
  db.insurers, db.drugs, db.distributors, db.cheques, db.doctors, db.fixedCosts, db.invoices, db.invoiceItems, db.inventoryLots,
];

const samplesOf = (table: (typeof SAMPLE_TABLES)[number]) =>
  (table as typeof db.drugs).filter((row) => row.sample === true);

export async function countSamples(): Promise<number> {
  let total = 0;
  for (const table of SAMPLE_TABLES) total += await samplesOf(table).count();
  return total;
}

export async function addSamples(): Promise<void> {
  const today = todayISO();
  const month = currentMonthKey();
  await db.transaction('rw', SAMPLE_TABLES, async () => {
    if ((await countSamples()) > 0) return;
    await db.insurers.add({
      name: 'بیمهٔ تکمیلی نمونه', delayMonths: 9, deductionRate: 0.04, priceListId: null,
      defaultShare: 0.5, active: true, sample: true,
    } as Insurer);
    const drugIds = (await db.drugs.bulkAdd([
      completeDrug({ genericName: 'داروی نمونهٔ الف', form: 'TAB', dose: '500 mg', price: 1_200_000, otc: false, manual: true, sample: true }),
      completeDrug({ genericName: 'داروی نمونهٔ ب', form: 'SYRUP', dose: '120 ml', price: 850_000, otc: true, manual: true, sample: true }),
    ] as Drug[], { allKeys: true })) as number[];
    const ids = (await db.distributors.bulkAdd(
      [
        { name: 'پخش نمونهٔ یک', baseChequeMonths: 3, earlyPayDiscountPerMonth: 0.02, sample: true },
        { name: 'پخش نمونهٔ دو', baseChequeMonths: 6, earlyPayDiscountPerMonth: 0.02, sample: true },
      ] as Distributor[],
      { allKeys: true },
    )) as number[];
    const invoiceId = (await db.invoices.add({
      number: 'نمونه-۱', date: today, distributorId: ids[0], payable: 8_800_000,
      payment: { type: 'cheque', chequeMonths: 3, dueDate: null, notes: '' }, sample: true,
    } as Invoice)) as number;
    const lines = [
      { drugId: drugIds[0], name: 'داروی نمونهٔ الف', qty: 10, bonus: 2, unitPrice: 800_000, consumerPrice: 1_200_000 },
      { drugId: drugIds[1], name: 'داروی نمونهٔ ب', qty: 1, bonus: 0, unitPrice: 800_000, consumerPrice: 850_000 },
    ];
    await db.invoiceItems.bulkAdd(
      lines.map((l) => {
        const f = lineFigures({ ...l, discountPercent: 0, discountAmount: 0, tax: 0 });
        return {
          invoiceId, drugId: l.drugId, name: l.name, quantity: l.qty, bonus: l.bonus, unitPrice: l.unitPrice,
          consumerPrice: l.consumerPrice, discount: 0, discountAmount: 0, tax: 0, total: f.paid,
          effectiveUnitCost: f.unitCost, marginOnSale: f.marginOnSale, marginOnCost: f.marginOnCost, sample: true,
        } as InvoiceItem;
      }),
    );
    await db.inventoryLots.bulkAdd(
      lines.map((l) => ({
        drugId: l.drugId, name: l.name, batch: 'نمونه', remaining: l.qty + l.bonus, source: 'فاکتور نمونه-۱', invoiceId, sample: true,
      }) as InventoryLot),
    );
    await db.cheques.bulkAdd([
      { distributorId: ids[0], amount: 1_800_000_000, dueDate: addDays(today, 6), status: 'pending', sample: true },
      { distributorId: ids[1], amount: 950_000_000, dueDate: addDays(today, 21), status: 'pending', sample: true },
      { distributorId: ids[0], amount: 2_400_000_000, dueDate: addDays(today, 75), status: 'pending', sample: true },
    ] as Cheque[]);
    const insurers = await db.insurers.toArray();
    const idOf = (part: string) => insurers.find((i) => i.name.includes(part))?.id;
    const tamin = idOf('تأمین');
    const salamat = idOf('سلامت');
    const insurerMix: Record<number, number> = tamin && salamat ? { [tamin]: 0.45, [salamat]: 0.35, 0: 0.2 } : { 0: 1 };
    const doctor = (name: string, specialty: string, rxPerDay: number, weekDays: number[], shift: Doctor['shift'], avgRxAmount: number) =>
      ({
        name, specialty, rxPerDay, weekDays, shift, avgRxAmount, workDays: Math.round(weekDays.length * 4.33), startMonth: month,
        insurerMix, captureRate: 0.7, officeRent: 400_000_000, pharmacyRentShare: 0.5, monthlyAllowance: 150_000_000, active: true,
        sample: true,
      }) as Doctor;
    await db.doctors.bulkAdd([
      doctor('پزشک زنان (نمونه)', 'زنان', 35, [0, 1, 2, 4], 'morning', 6_000_000),
      doctor('پزشک کودکان (نمونه)', 'کودکان', 50, [0, 1, 2, 3, 4, 5], 'both', 3_500_000),
      doctor('پزشک داخلی (نمونه)', 'داخلی', 50, [0, 1, 2, 3, 4, 5], 'both', 5_000_000),
      doctor('پزشک قلب (نمونه)', 'قلب', 30, [0, 1, 2, 3, 4, 5], 'both', 7_000_000),
    ]);
    await db.fixedCosts.add({
      title: 'اجارهٔ داروخانه (نمونه)', amount: 1_500_000_000, startMonth: month, sample: true,
    } as FixedCost);
  });
}

export async function clearSamples(): Promise<void> {
  await db.transaction('rw', SAMPLE_TABLES, async () => {
    for (const table of SAMPLE_TABLES) await samplesOf(table).delete();
  });
}
