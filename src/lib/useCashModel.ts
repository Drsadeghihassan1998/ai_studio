import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildCashInputs, runCash } from './cashflow';
import { db, type Settings } from './db';
import { buildContext } from './doctors';

/** همهٔ داده‌های لازم برای نقدینگی را می‌خواند و پیش‌بینی پایه (بدون تست فشار) را می‌سازد. */
export function useCashModel(settings: Settings) {
  const data = useLiveQuery(async () => {
    const [
      doctors, profiles, drugs, coverage, insurers, lists, items, invoices, distributors, sales, fixedCosts, oneOffCosts, cheques,
    ] = await Promise.all([
      db.doctors.toArray(), db.doctorDrugProfile.toArray(), db.drugs.toArray(), db.coverage.toArray(), db.insurers.toArray(),
      db.priceLists.toArray(), db.invoiceItems.toArray(), db.invoices.toArray(), db.distributors.toArray(), db.sales.toArray(),
      db.fixedCosts.toArray(), db.oneOffCosts.toArray(), db.cheques.toArray(),
    ]);
    return {
      doctors, profiles, drugs, coverage, insurers, lists, items, invoices, distributors, sales, fixedCosts, oneOffCosts, cheques,
    };
  });

  return useMemo(() => {
    if (!data) return null;
    const ctx = buildContext({ ...data, settings });
    const input = buildCashInputs({ ...data, settings, ctx });
    return { data, ctx, input, months: runCash(input) };
  }, [data, settings]);
}
