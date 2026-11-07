import { useDeferredValue, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Award, BadgePercent, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { db, type Distributor, type Drug, type Offer } from '../lib/db';
import { drugConsumption, forecastDoctor, FREE_KEY } from '../lib/doctors';
import { insurerColumn } from '../lib/drugbank';
import { faDate, faNumber, faPercent, fullMoney } from '../lib/format';
import { latestPurchases } from '../lib/invoice';
import { currentMonthKey, jalaliParts, monthLabel, parseJalaliDate, todayISO } from '../lib/jalali';
import {
  advantage, compareQuickOffers, decide, expiryCheck, liquidity, monthsToSell, offerCashSeries, parseOfferText,
  paymentOptions, paymentPhrase, presentProfit, sensitivity, totalUnits, verdictText,
  type CashContext, type MixRow, type OfferInput, type QuickCompareContext, type QuickOfferRow,
} from '../lib/offer';
import { drugTitle, fullDrugDose, fullDrugName, searchDrugs } from '../lib/drugname';
import { normalizeText } from '../lib/text';
import { useCashModel } from '../lib/useCashModel';
import { Badge, Button, Card, CardTitle, ConfirmButton, EmptyState, PageHeader, PageSkeleton, Segmented, type Tone } from './ui/basics';
import { DateField, Field, MoneyField, MoreSettings, NumberField, PercentField, SelectBox, TextField } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { LinesChart, SERIES } from './Charts';
import { useSettings, useUnit } from './SettingsContext';

type Tab = 'new' | 'quick' | 'compare';

interface Form extends OfferInput {
  title: string;
  drugId: number | null;
  distributorId: number | null;
}

interface SavedResult {
  verdict: string;
  tone: Tone;
  qty: number;
  month: number;
  advantage: number;
  unitCost: number;
  monthsToSell: number;
}

const toneOf = (kind: string): Tone => (kind === 'no' ? 'bad' : kind === 'limit' ? 'warn' : 'good');

function monthsUntil(iso: string): number {
  const a = jalaliParts(todayISO());
  const b = jalaliParts(iso);
  return Math.max(0, (b.y - a.y) * 12 + (b.m - a.m) + (b.d - a.d) / 30);
}

function DrugPicker({ drugs, onPick }: { drugs: Drug[]; onPick: (d: Drug) => void }) {
  const [query, setQuery] = useState('');
  const aliases = useLiveQuery(() => db.drugAliases.toArray()) ?? [];
  const results = useMemo(() => searchDrugs(drugs, query, aliases, 25), [query, drugs, aliases]);
  return (
    <div>
      <label htmlFor="offer-drug" className="mb-1 block text-note font-medium">دارو از بانک</label>
      <input
        id="offer-drug"
        type="search"
        placeholder="جستجو با نام، ترکیب یا کد"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-line bg-card px-4 text-ink"
      />
      {results.length > 0 && (
        <div className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-card shadow-card">
          {results.map((drug) => {
            const name = fullDrugName(drug);
            const dose = fullDrugDose(drug);
            const form = drug.form || drug.formFamily;
            return (
              <button
                key={drug.id}
                type="button"
                dir="auto"
                onClick={() => {
                  onPick(drug);
                  setQuery('');
                }}
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-start last:border-0 hover:bg-app hover:text-primary"
              >
                <span className="font-medium">
                  {name}
                  {dose ? ` ${dose}` : ''}
                </span>
                {form && <span className="text-note text-muted">{form}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MixEditor({ mix, onChange }: { mix: MixRow[]; onChange: (mix: MixRow[]) => void }) {
  const set = (key: number, patch: Partial<MixRow>) => onChange(mix.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = mix.reduce((s, r) => s + r.share, 0);
  const ok = Math.abs(total - 1) < 0.0001;
  return (
    <section aria-label="ترکیب بیمه برای این دارو">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-note font-medium">ترکیب بیمه برای این دارو</p>
        <Badge tone={ok ? 'good' : 'bad'}>جمع {faNumber(total * 100, 2)}٪</Badge>
      </div>
      <div className="grid gap-2">
        {mix.map((row) => (
          <div key={row.key} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_repeat(4,112px)]">
            <span className="col-span-2 pb-2 font-medium sm:col-span-1">{row.name}</span>
            <PercentField label="سهم بیماران" value={row.share} onChange={(share) => set(row.key, { share })} />
            {row.key !== FREE_KEY && (
              <>
                <PercentField label="سهم بیمه" value={row.rate} onChange={(rate) => set(row.key, { rate })} />
                <NumberField label="تأخیر (ماه)" value={row.delay} onChange={(delay) => set(row.key, { delay })} />
                <PercentField label="کسورات" value={row.deduction} onChange={(deduction) => set(row.key, { deduction })} />
              </>
            )}
          </div>
        ))}
      </div>
      {!ok && <p className="mt-1 text-note text-bad" role="alert">جمع سهم بیماران باید ۱۰۰٪ باشد.</p>}
    </section>
  );
}

function Results({ form, cash, onSave }: { form: Form; cash: CashContext; onSave: (result: SavedResult) => void }) {
  const unit = useUnit();
  const money = (rial: number) => fullMoney(Math.round(rial), unit);
  const verdict = decide(form, cash);
  const options = paymentOptions(form, form.qty);
  const check = expiryCheck(form, form.qty);
  const shownMonth = verdict.kind === 'no' ? form.baseMonths : verdict.month;
  const shownQty = verdict.kind === 'limit' ? verdict.qty : form.qty;
  const after = liquidity(form, shownQty, shownMonth, cash);
  const cashTable = sensitivity(form, form.qty, 0);
  const chosenTable = sensitivity(form, form.qty, shownMonth);
  const profit = presentProfit(form, shownQty, shownMonth);
  const series = offerCashSeries(form, shownQty, shownMonth);
  const chosen = options.find((o) => o.month === shownMonth);
  const cashOption = options[0];
  const r = faPercent(form.r);

  const reasons: string[] = [];
  if (verdict.kind === 'no' && profit <= 0) {
    reasons.push(`این خرید با احتساب تأخیر بیمه زیان می‌دهد: ارزش امروز سود آن ${money(profit)} است.`);
    if (chosen && chosen.advantage > 0) {
      reasons.push(`اگر این دارو را به هر حال باید داشته باشید، این گزینه ${money(chosen.advantage)} از خرید عادی بهتر است.`);
    }
  } else if (verdict.kind === 'no') {
    reasons.push(`هیچ گزینه‌ای از خرید عادی بهتر نیست؛ بهترین حالت ${money(verdict.advantage)} مزیت دارد.`);
  } else {
    reasons.push(`ارزش امروز این خرید ${money(verdict.advantage)} از خرید عادی بهتر است.`);
  }
  if (form.discountPerMonth <= 0) {
    reasons.push('تخفیف زودپرداخت ندارد، پس پرداخت دیرتر به نفع شماست.');
  } else if (shownMonth === 0) {
    reasons.push(`با هزینهٔ پول ${r} در ماه، تخفیف نقدی از نگه داشتن پول بیشتر می‌ارزد.`);
  } else {
    reasons.push(
      `با هزینهٔ پول ${r} در ماه، تخفیف نقدی ارزش پرداخت زودتر را ندارد: مزیت نقد ${money(advantage(form, shownQty, 0, form.r))} است و این گزینه ${money(advantage(form, shownQty, shownMonth, form.r))}.`,
    );
  }
  if (check.risky) {
    reasons.push(
      `فروش ${faNumber(form.qty)} عدد ${faNumber(check.months, 1)} ماه طول می‌کشد ولی فقط ${faNumber(check.limit, 1)} ماه وقت امن هست.`,
    );
  } else if (verdict.kind === 'limit') {
    reasons.push(`خرید ${faNumber(form.qty)} عدد نقدینگی را بدتر می‌کند؛ ${faNumber(verdict.qty)} عدد بیشترین مزیت را بدون این مشکل دارد.`);
  } else if (cash.active && !after.ok) {
    reasons.push('این خرید موجودی نقد را زیر حداقل امن می‌برد.');
  } else {
    reasons.push(
      `این تعداد ${faNumber(monthsToSell(form, shownQty), 1)} ماهه فروش می‌رود و تا انقضا ${faNumber(form.monthsToExpiry, 1)} ماه وقت هست.`,
    );
  }

  const label = (m: number) => (m === 0 ? 'نقد (۰)' : faNumber(m));
  const tone = toneOf(verdict.kind);
  const text = verdictText(form, verdict);
  const betterQty = verdict.optimal && verdict.optimal.qty !== shownQty && verdict.optimal.advantage > verdict.advantage;

  return (
    <div className="mt-6 grid grid-cols-1 gap-4">
      <Card>
        <p className="text-note text-muted">حکم</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
          <p className="text-key font-bold">{text}</p>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                verdict: text, tone, qty: shownQty, month: shownMonth, advantage: verdict.advantage,
                unitCost: chosen?.unitCost ?? 0, monthsToSell: monthsToSell(form, shownQty),
              })
            }
          >
            ذخیرهٔ ارزیابی
          </Button>
        </div>
        <ol className="mt-4 grid gap-1">
          {reasons.slice(0, 3).map((reason, i) => (
            <li key={i}>{faNumber(i + 1)}. {reason}</li>
          ))}
        </ol>
        {profit < 0 && verdict.kind !== 'no' && (
          <p className="mt-2 text-note text-bad">با احتساب تأخیر بیمه، ارزش امروز خود این خرید منفی است ({money(profit)}).</p>
        )}
        {betterQty && (
          <p className="mt-2 text-note text-muted">
            بهترین تعداد: {faNumber(verdict.optimal!.qty)} عدد، {paymentPhrase(form, verdict.optimal!.month)}، با مزیت {money(verdict.optimal!.advantage)}.
          </p>
        )}
      </Card>

      {check.risky && (
        <section className="rounded-xl border border-bad/40 bg-card p-4">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert size={18} className="mt-1 shrink-0 text-bad" aria-hidden />
            <span>
              خطر انقضا: فروش {faNumber(check.months, 1)} ماه طول می‌کشد، از {faNumber(check.limit, 1)} ماه وقت امن بیشتر است.
              {check.unsold > 0 ? ` ${faNumber(check.unsold)} عدد تا انقضا فروش نمی‌رود.` : ''}
            </span>
          </p>
        </section>
      )}

      <Card flush>
        <div className="px-6 pt-6">
          <CardTitle note={`برای ${faNumber(form.qty)} عدد خرید؛ ${faNumber(totalUnits(form, form.qty))} عدد با بونوس، ${faNumber(monthsToSell(form, form.qty), 1)} ماه برای فروش.`}>
            گزینه‌های پرداخت
          </CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-line text-note text-muted">
                {['ماه پرداخت', 'تخفیف', 'مبلغ پرداختی', 'قیمت تمام‌شدهٔ هر واحد', 'مزیت نسبت به خرید عادی', 'نرخ سربه‌سر'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {options.map((o) => (
                <tr key={o.month} className={`border-b border-line last:border-0 ${o.month === shownMonth ? 'bg-app font-medium' : ''}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{label(o.month)}</td>
                  <td className="px-4 py-2">{faPercent(o.discount)}</td>
                  <td className="px-4 py-2 whitespace-nowrap"><Money rial={o.paid} exact /></td>
                  <td className="px-4 py-2 whitespace-nowrap"><Money rial={o.unitCost} exact /></td>
                  <td className="px-4 py-2 whitespace-nowrap"><Money rial={o.advantage} exact /></td>
                  <td className="px-4 py-2 whitespace-nowrap">{o.breakEven === null ? '—' : `${faNumber(o.breakEven * 100, 2)}٪ در ماه`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle note="مزیت نسبت به خرید عادی با هزینه‌های پول مختلف.">جدول حساسیت</CardTitle>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-note text-muted">
                <th scope="col" className="py-2 text-start font-medium">هزینهٔ پول</th>
                <th scope="col" className="py-2 text-start font-medium">مزیت نقد</th>
                {shownMonth !== 0 && <th scope="col" className="py-2 text-start font-medium">مزیت ماه {faNumber(shownMonth)}</th>}
              </tr>
            </thead>
            <tbody>
              {cashTable.map((row, i) => (
                <tr key={row.r} className="border-b border-line last:border-0">
                  <td className="py-2">{faPercent(row.r)}</td>
                  <td className="py-2"><Money rial={row.advantage} exact /></td>
                  {shownMonth !== 0 && <td className="py-2"><Money rial={chosenTable[i].advantage} exact /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-4 text-note">
            نرخ سربه‌سر پرداخت نقد: {cashOption.breakEven === null ? 'ندارد' : `${faNumber(cashOption.breakEven * 100, 2)}٪ در ماه`}
            <HowCalculated
              title="نرخ سربه‌سر پرداخت نقد"
              formula="هزینهٔ پولی که با آن مزیت پرداخت نقد نسبت به خرید عادی صفر می‌شود؛ با روش دوبخشی پیدا شده است."
              inputs={[['هزینهٔ پول فعلی', r]]}
            />
          </div>
        </Card>

        <Card>
          <CardTitle note="این آفر به جای خرید عادی همین دارو در پیش‌بینی نقدینگی گذاشته شده است.">اثر روی نقدینگی کل</CardTitle>
          {cash.active ? (
            <>
              <dl>
                <div className="flex justify-between gap-4 border-b border-line py-2">
                  <dt className="text-muted">کمترین موجودی قبل از آفر</dt>
                  <dd><Money rial={after.before} exact /></dd>
                </div>
                <div className="flex justify-between gap-4 py-2 font-bold">
                  <dt>کمترین موجودی بعد از آفر</dt>
                  <dd><Money rial={after.after} exact /></dd>
                </div>
              </dl>
              <Badge tone={after.after >= cash.minSafe ? 'good' : after.ok ? 'warn' : 'bad'}>
                {after.after >= cash.minSafe
                  ? 'زیر حداقل امن نمی‌رود'
                  : after.ok
                    ? 'از قبل زیر حداقل امن است؛ این آفر بدترش نمی‌کند'
                    : 'زیر حداقل امن می‌رود'}
              </Badge>
            </>
          ) : (
            <p className="text-muted">پیش‌بینی نقدینگی هنوز داده ندارد. موجودی نقد اولیه و پزشکان را وارد کنید.</p>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle note={`جمع پول ورودی منهای خروجی، برای ${faNumber(shownQty)} عدد ${paymentPhrase(form, shownMonth)}.`}>جریان نقد انباشته</CardTitle>
        <LinesChart
          label="نمودار جریان نقد انباشتهٔ آفر و خرید عادی"
          series={[
            { name: 'این آفر', color: SERIES[0], values: series.offer },
            { name: 'خرید عادی', color: SERIES[1], values: series.base },
          ]}
        />
      </Card>
    </div>
  );
}

function QuickCompare({
  drugs,
  defaultRate,
  onResolveDrugDefaults,
  onSendToFull,
}: {
  drugs: Drug[];
  defaultRate: number;
  onResolveDrugDefaults: (drug: Drug) => { monthlyUse: number; price: number; stock: number };
  onSendToFull: (row: QuickOfferRow, ctx: QuickCompareContext, drug: Drug | null) => void;
}) {
  const unit = useUnit();
  const money = (rial: number) => fullMoney(Math.round(rial), unit);
  const [selectedDrug, setSelectedDrug] = useState<Drug | null>(null);
  const [ctx, setCtx] = useState<QuickCompareContext>({
    monthlyUse: 30,
    unitPrice: 0,
    r: defaultRate,
    normalMonths: 3,
    monthsToExpiry: 18,
    safetyMonths: 2,
    stock: 0,
  });

  const [rows, setRows] = useState<QuickOfferRow[]>([
    {
      id: '1',
      title: 'پیشنهاد شرکت اول',
      rawText: '100 عدد بخر 20 عدد آفر چک 6 ماهه',
      buyQty: 100,
      freeQty: 20,
      chequeMonths: 6,
      discountPerMonth: 0,
    },
    {
      id: '2',
      title: 'پیشنهاد شرکت دوم',
      rawText: '70 عدد بخر 15 عدد آفر چک 5 ماهه',
      buyQty: 70,
      freeQty: 15,
      chequeMonths: 5,
      discountPerMonth: 0,
    },
  ]);

  const setCtxPatch = (patch: Partial<QuickCompareContext>) => setCtx((prev) => ({ ...prev, ...patch }));

  const updateRow = (id: string, patch: Partial<QuickOfferRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleTextChange = (id: string, rawText: string) => {
    const parsed = parseOfferText(rawText);
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          rawText,
          buyQty: parsed.buyQty !== undefined ? parsed.buyQty : r.buyQty,
          freeQty: parsed.freeQty !== undefined ? parsed.freeQty : r.freeQty,
          chequeMonths: parsed.chequeMonths !== undefined ? parsed.chequeMonths : r.chequeMonths,
          discountPerMonth: parsed.discountPerMonth !== undefined ? parsed.discountPerMonth : r.discountPerMonth,
        };
      }),
    );
  };

  const addRow = () => {
    const nextNum = rows.length + 1;
    setRows((prev) => [
      ...prev,
      {
        id: String(Date.now() + nextNum),
        title: `پیشنهاد شرکت ${faNumber(nextNum)}`,
        rawText: '',
        buyQty: 50,
        freeQty: 10,
        chequeMonths: 4,
        discountPerMonth: 0,
      },
    ]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 2) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const { evaluations, winner, runnerUp, noneBeatsNormal } = useMemo(() => compareQuickOffers(rows, ctx), [rows, ctx]);
  const hasRealPrice = ctx.unitPrice > 0;
  const effectiveBasePrice = ctx.unitPrice > 0 ? ctx.unitPrice : 100_000;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardTitle note="برای مقایسهٔ سریع چند آفر، مصرف ماهانهٔ دارو را وارد کنید. انتخاب دارو و قیمت واحد اختیاری است.">
          شرایط مشترک دارو و داروخانه
        </CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <DrugPicker
              drugs={drugs}
              onPick={(d) => {
                setSelectedDrug(d);
                const defaults = onResolveDrugDefaults(d);
                setCtx((prev) => ({
                  ...prev,
                  monthlyUse: defaults.monthlyUse > 0 ? defaults.monthlyUse : prev.monthlyUse,
                  unitPrice: defaults.price > 0 ? defaults.price : d.price || prev.unitPrice,
                  stock: defaults.stock,
                }));
              }}
            />
            {selectedDrug && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-note">
                <Badge tone="good">داروی انتخاب‌شده</Badge>
                <span dir="auto" className="font-medium">{drugTitle(selectedDrug)}</span>
                <Button variant="text" className="min-h-9 px-2" onClick={() => setSelectedDrug(null)}>
                  حذف انتخاب دارو
                </Button>
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <NumberField
              label="مصرف ماهانهٔ دارو"
              suffix="عدد"
              value={ctx.monthlyUse}
              onChange={(monthlyUse) => setCtxPatch({ monthlyUse })}
            />
            <MoneyField
              label="قیمت خرید واحد (اختیاری)"
              value={ctx.unitPrice}
              onChange={(unitPrice) => setCtxPatch({ unitPrice })}
            />
            <PercentField
              label="هزینهٔ پول ماهانه"
              value={ctx.r}
              onChange={(r) => setCtxPatch({ r })}
            />
          </div>
        </div>
        <div className="mt-4">
          <MoreSettings>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <NumberField
                label="مدت چک خرید عادی (مبنا)"
                suffix="ماه"
                value={ctx.normalMonths}
                onChange={(normalMonths) => setCtxPatch({ normalMonths: Math.round(normalMonths) })}
              />
              <NumberField
                label="ماه تا انقضا"
                suffix="ماه"
                value={ctx.monthsToExpiry}
                onChange={(monthsToExpiry) => setCtxPatch({ monthsToExpiry })}
              />
              <NumberField
                label="موجودی فعلی"
                suffix="عدد"
                value={ctx.stock}
                onChange={(stock) => setCtxPatch({ stock })}
              />
            </div>
          </MoreSettings>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row, idx) => {
          const ev = evaluations.find((e) => e.id === row.id);
          const isWinner = !noneBeatsNormal && winner && winner.id === row.id && evaluations.length > 1;
          const worseThanNormal = ev ? ev.totalAdvantage <= 0 : false;
          return (
            <Card key={row.id} className={isWinner ? 'border-good' : worseThanNormal ? 'border-bad/50' : ''}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-cardtitle font-bold">پیشنهاد {faNumber(idx + 1)}</span>
                  {isWinner && <Badge tone="good">بهترین پیشنهاد</Badge>}
                  {worseThanNormal && <Badge tone="bad">نخرید</Badge>}
                  {ev?.expiryRisky && <Badge tone="bad">خطر انقضا</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="text"
                    className="min-h-9 px-2 text-note"
                    onClick={() => onSendToFull(row, ctx, selectedDrug)}
                  >
                    بررسی کامل در فرم اصلی
                  </Button>
                  {rows.length > 2 && (
                    <Button
                      variant="text"
                      className="min-h-9 px-2 text-bad"
                      aria-label={`حذف ${row.title}`}
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-4">
                <TextField
                  label="عنوان یا نام شرکت پخش"
                  value={row.title}
                  onChange={(e) => updateRow(row.id, { title: e.target.value })}
                />

                <div>
                  <label htmlFor={`smart-offer-${row.id}`} className="mb-1 flex items-center gap-2 text-note font-medium">
                    <Sparkles size={15} className="text-primary" aria-hidden />
                    <span>ورود متنی هوشمند آفر (بنویسید تا کادرهای عدد خودکار پر شوند)</span>
                  </label>
                  <input
                    id={`smart-offer-${row.id}`}
                    type="text"
                    dir="auto"
                    placeholder="مثلاً: 100 عدد بخر 20 عدد آفر چک 6 ماهه (یا 100+20 چک 6 ماه)"
                    value={row.rawText}
                    onChange={(e) => handleTextChange(row.id, e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-line bg-app/50 px-4 text-ink"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <NumberField
                    label="تعداد خرید"
                    suffix="عدد"
                    value={row.buyQty}
                    onChange={(buyQty) => updateRow(row.id, { buyQty })}
                  />
                  <NumberField
                    label="تعداد آفر رایگان"
                    suffix="عدد"
                    value={row.freeQty}
                    onChange={(freeQty) => updateRow(row.id, { freeQty })}
                  />
                  <NumberField
                    label="مهلت چک"
                    suffix="ماه"
                    value={row.chequeMonths}
                    onChange={(chequeMonths) => updateRow(row.id, { chequeMonths: Math.round(chequeMonths) })}
                  />
                  <PercentField
                    label="تخفیف زودپرداخت"
                    value={row.discountPerMonth}
                    onChange={(discountPerMonth) => updateRow(row.id, { discountPerMonth })}
                  />
                </div>

                {ev && (
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-app/40 p-4 text-note sm:grid-cols-3">
                    <div>
                      <span className="block text-muted">کل دریافتی</span>
                      <span className="font-bold text-ink">{faNumber(ev.totalQty)} عدد</span>
                    </div>
                    <div>
                      <span className="block text-muted">تخفیف کالایی (بونوس)</span>
                      <span className="font-bold text-ink">{faPercent(ev.bonusDiscountRate)}</span>
                    </div>
                    <div>
                      <span className="flex items-center gap-1 text-muted">
                        <span>تخفیف واقعی امروز (با چک)</span>
                        <HowCalculated
                          title={`تخفیف واقعی امروز (${ev.title})`}
                          formula="۱ − (ارزش امروز پرداختی هر واحد قابل فروش ÷ فی پایه) — ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد"
                          inputs={[
                            ['ارزش امروز کل پرداختی', money(ev.presentPaid)],
                            ['تعداد قابل فروش تا انقضا', `${faNumber(ev.sellableQty)} عدد`],
                            ['ارزش امروز هر واحد قابل فروش', money(ev.presentUnitCost)],
                            ['فی پایه', money(effectiveBasePrice)],
                          ]}
                          result={['تخفیف واقعی امروز (بدون لحاظ زمان فروش)', faPercent(ev.realDiscountRate)]}
                        />
                      </span>
                      <span className="font-bold text-primary">{faPercent(ev.realDiscountRate)}</span>
                    </div>
                    {ctx.monthlyUse > 0 && (
                      <div className="col-span-2 sm:col-span-3">
                        <span className="text-muted">زمان فروش کل بار: </span>
                        <span className="font-medium text-ink">{faNumber(ev.monthsToSell, 1)} ماه</span>
                        <span className="ms-2">
                          {ev.expiryRisky ? (
                            <Badge tone="bad">بیشتر از مهلت امن انقضا ({faNumber(ev.unsoldQty)} عدد در خطر انقضا)</Badge>
                          ) : ev.sellsBeforeCheque ? (
                            <Badge tone="good">قبل از سررسید چک کامل فروش می‌رود</Badge>
                          ) : (
                            <Badge tone="warn">فروش بار از سررسید چک ({faNumber(ev.chequeMonths)} ماه) طولانی‌تر است</Badge>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div>
        <Button onClick={addRow}>
          <Plus size={18} aria-hidden />
          <span>افزودن پیشنهاد شرکت دیگر</span>
        </Button>
      </div>

      {winner && evaluations.length >= 1 && (
        noneBeatsNormal ? (
          <Card className="border-bad">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TriangleAlert size={22} className="text-bad" aria-hidden />
                <p className="text-key font-bold">هیچ‌کدام از خرید عادی ماه‌به‌ماه بهتر نیست</p>
                <Badge tone="bad">نخرید</Badge>
              </div>
              <HowCalculated
                title="چرا هیچ‌کدام از خرید عادی بهتر نیست؟"
                formula="مزیت نسبت به خرید عادی = ارزش امروز خرید عادی ماه‌به‌ماه − ارزش امروز پرداخت این آفر"
                inputs={[
                  ['بهترین پیشنهاد بررسی‌شده', `${winner.title} (${faNumber(winner.buyQty)} + ${faNumber(winner.freeQty)}، چک ${faNumber(winner.chequeMonths)} ماهه)`],
                  ['ارزش امروز خرید عادی ماه‌به‌ماه', money(winner.baselinePresentPaid)],
                  ['ارزش امروز پرداخت این آفر', money(winner.presentPaid)],
                  ['زمان فروش کل بار', `${faNumber(winner.monthsToSell, 1)} ماه`],
                ]}
                result={['مزیت نسبت به خرید عادی', money(winner.totalAdvantage)]}
              />
            </div>
            <p className="mt-4 text-body text-muted">
              با توجه به مصرف ماهانهٔ <strong>{faNumber(ctx.monthlyUse)} عدد</strong> و هزینهٔ پول <strong>{faPercent(ctx.r)}</strong> در ماه، خواب سرمایه در قفسه باعث می‌شود ارزش امروز پرداخت همهٔ پیشنهادهای واردشده از خرید عادی ماه‌به‌ماه (با چک {faNumber(ctx.normalMonths)} ماهه) بیشتر تمام شود.
            </p>
          </Card>
        ) : evaluations.length >= 2 ? (
          <Card className="border-good">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award size={22} className="text-good" aria-hidden />
                <p className="text-key font-bold">برندهٔ مقایسه: {winner.title}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="good">مزیت نسبت به خرید عادی: {money(winner.totalAdvantage)}</Badge>
                <HowCalculated
                  title="نحوهٔ انتخاب بهترین پیشنهاد"
                  formula="رتبه‌بندی: ۱) بدون خطر انقضا ۲) بیشترین مزیت ارزش فعلی نسبت به خرید عادی ماه‌به‌ماه ۳) تخفیف واقعی هر واحد"
                  inputs={[
                    ['پیشنهاد برنده', `${winner.title} (${faNumber(winner.buyQty)} + ${faNumber(winner.freeQty)}، چک ${faNumber(winner.chequeMonths)} ماهه)`],
                    ['ارزش امروز خرید عادی ماه‌به‌ماه', money(winner.baselinePresentPaid)],
                    ['ارزش امروز پرداخت این آفر', money(winner.presentPaid)],
                    ['مزیت نسبت به خرید عادی', money(winner.totalAdvantage)],
                    ['تخفیف واقعی امروز هر واحد (بدون لحاظ زمان فروش)', faPercent(winner.realDiscountRate)],
                  ]}
                  result={['برنده', winner.title]}
                />
              </div>
            </div>

            <ul className="mt-4 grid gap-2 text-body">
              <li>
                ۱. در مقایسه با خرید عادی ماه‌به‌ماه (چک {faNumber(ctx.normalMonths)} ماهه)، پیشنهاد <strong>{winner.title}</strong> پس از در نظر گرفتن زمان فروش بار ({faNumber(winner.monthsToSell, 1)} ماه) به اندازهٔ <strong>{money(winner.totalAdvantage)}</strong> به ارزش پول امروز به نفع داروخانه است.
              </li>
              <li>
                ۲. تخفیف واقعی امروز هر واحد قابل فروش نسبت به فی پایه <strong>{faPercent(winner.realDiscountRate)}</strong> است (ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد).
              </li>
              {runnerUp && (
                <li>
                  ۳. در مقایسه با <strong>{runnerUp.title}</strong> (مزیت نسبت به خرید عادی: {money(runnerUp.totalAdvantage)} و تخفیف واقعی واحد: {faPercent(runnerUp.realDiscountRate)})، پیشنهاد <strong>{winner.title}</strong> به میزان <strong>{money(winner.totalAdvantage - runnerUp.totalAdvantage)}</strong> ارزش فعلی بیشتری ایجاد می‌کند.
                </li>
              )}
            </ul>
          </Card>
        ) : null
      )}

      {evaluations.length > 0 && (
        <Card flush>
          <div className="px-6 pt-6">
            <CardTitle note={hasRealPrice ? 'مبالغ بر اساس قیمت واحد واردشده محاسبه شده‌اند.' : 'قیمت واحد وارد نشده؛ ستون‌های مبلغ بر پایهٔ فرضی ۱۰۰٬۰۰۰ ریال برای مقایسهٔ نسبی هستند.'}>
              جدول مقایسهٔ شانه به شانهٔ پیشنهادها
            </CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-line text-note text-muted">
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">پیشنهاد</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">خرید + آفر (کل)</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">مهلت چک</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">تخفیف کالایی (بونوس)</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span>تخفیف واقعی امروز</span>
                      <HowCalculated
                        title="تخفیف واقعی امروز"
                        formula="۱ − (ارزش امروز پرداختی هر واحد قابل فروش ÷ فی پایه) — ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد"
                        inputs={[
                          ['معنی شاخص', 'ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد'],
                          ['هزینهٔ پول ماهانه', faPercent(ctx.r)],
                        ]}
                        result={['تذکر', 'برای لحاظ شدن زمان خواب کالا در قفسه، ستون «مزیت نسبت به خرید عادی» ملاک برنده است']}
                      />
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">قیمت تمام‌شدهٔ اسمی واحد</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">قیمت واحد به ارزش امروز</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">زمان فروش کل بار</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">مزیت نسبت به خرید عادی</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((ev) => {
                  const isWin = !noneBeatsNormal && winner && winner.id === ev.id && evaluations.length > 1;
                  const isBad = ev.totalAdvantage <= 0;
                  return (
                    <tr key={ev.id} className={`border-b border-line last:border-0 ${isWin ? 'bg-app font-medium' : ''}`}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span>{ev.title}</span>
                          {isWin && <Badge tone="good">برنده</Badge>}
                          {isBad && <Badge tone="bad">نخرید</Badge>}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {faNumber(ev.buyQty)} + {faNumber(ev.freeQty)} ({faNumber(ev.totalQty)} عدد)
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {ev.chequeMonths === 0 ? 'نقد' : `${faNumber(ev.chequeMonths)} ماهه`}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{faPercent(ev.bonusDiscountRate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap font-bold text-primary">
                        <span className="inline-flex items-center gap-1">
                          <span>{faPercent(ev.realDiscountRate)}</span>
                          <HowCalculated
                            title={`تخفیف واقعی امروز (${ev.title})`}
                            formula="ارزش امروز پرداختی هر واحد قابل فروش نسبت به فی پایه؛ زمان فروش را در نظر نمی‌گیرد"
                            inputs={[
                              ['ارزش امروز پرداختی کل', money(ev.presentPaid)],
                              ['تعداد قابل فروش', `${faNumber(ev.sellableQty)} عدد`],
                              ['ارزش امروز هر واحد قابل فروش', money(ev.presentUnitCost)],
                              ['فی پایه', money(effectiveBasePrice)],
                            ]}
                            result={['تخفیف واقعی امروز', faPercent(ev.realDiscountRate)]}
                          />
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap"><Money rial={ev.nominalUnitCost} exact /></td>
                      <td className="px-4 py-2 whitespace-nowrap"><Money rial={ev.presentUnitCost} exact /></td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {ctx.monthlyUse > 0 ? `${faNumber(ev.monthsToSell, 1)} ماه` : '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Money rial={ev.totalAdvantage} exact />
                          <HowCalculated
                            title={`مزیت نسبت به خرید عادی (${ev.title})`}
                            formula="ارزش امروز خرید عادی ماه‌به‌ماه − ارزش امروز پرداخت این آفر"
                            inputs={[
                              ['ارزش امروز خرید عادی ماه‌به‌ماه', money(ev.baselinePresentPaid)],
                              ['ارزش امروز پرداخت این آفر', money(ev.presentPaid)],
                              ['تعداد قابل فروش تا انقضا', `${faNumber(ev.sellableQty)} عدد`],
                              ['زمان فروش کل بار', `${faNumber(ev.monthsToSell, 1)} ماه`],
                            ]}
                            result={['مزیت نسبت به خرید عادی', money(ev.totalAdvantage)]}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Compare({ offers, onOpen }: { offers: Offer[]; onOpen: (offer: Offer) => void }) {
  const toast = useToast();
  if (offers.length === 0) return <EmptyState icon={BadgePercent} text="هنوز ارزیابی‌ای ذخیره نشده است. یک آفر را بررسی و ذخیره کنید." />;

  // پیدا کردن بهترین آفر ذخیره‌شده بر اساس بیشترین مزیت مثبت
  const bestOfferId = useMemo(() => {
    let bestId: number | null = null;
    let bestAdv = -Infinity;
    for (const o of offers) {
      const r = o.result as SavedResult;
      if (r.tone !== 'bad' && r.advantage > bestAdv) {
        bestAdv = r.advantage;
        bestId = o.id;
      }
    }
    return offers.length > 1 ? bestId : null;
  }, [offers]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {offers.map((offer) => {
        const result = offer.result as SavedResult;
        const input = offer.input as Form;
        const isBest = bestOfferId !== null && offer.id === bestOfferId;
        const rows: [string, React.ReactNode][] = [
          ['تعداد', `${faNumber(result.qty)} عدد`],
          ['ماه پرداخت', result.month === 0 ? 'نقد' : `ماه ${faNumber(result.month)}`],
          ['قیمت تمام‌شدهٔ هر واحد', <Money rial={result.unitCost} exact />],
          ['مزیت نسبت به خرید عادی', <Money rial={result.advantage} exact />],
          ['ماه‌های لازم برای فروش', faNumber(result.monthsToSell, 1)],
          ['هزینهٔ پول', faPercent(input.r)],
        ];
        return (
          <Card key={offer.id} className={isBest ? 'border-good' : ''}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 dir="auto" className="text-cardtitle font-medium">{offer.title}</h2>
              {isBest && <Badge tone="good">بهترین پیشنهاد ذخیره‌شده</Badge>}
            </div>
            <p className="text-note text-muted">{faDate(offer.createdAt.slice(0, 10))}</p>
            <p className="my-2"><Badge tone={result.tone}>{result.verdict}</Badge></p>
            <dl>
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
                  <dt className="text-note text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button onClick={() => onOpen(offer)}>باز کردن</Button>
              <ConfirmButton
                label="حذف"
                question="حذف شود؟"
                confirmLabel="حذف کن"
                onConfirm={async () => {
                  await db.offers.delete(offer.id);
                  toast('ارزیابی حذف شد');
                }}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function Offers() {
  const settings = useSettings();
  const toast = useToast();
  const model = useCashModel(settings);
  const offers = useLiveQuery(() => db.offers.toArray()) ?? [];
  const lots = useLiveQuery(() => db.inventoryLots.toArray()) ?? [];
  const [tab, setTab] = useState<Tab>('new');
  const [form, setForm] = useState<Form | null>(null);
  const [smartText, setSmartText] = useState('');
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const deferred = useDeferredValue(form);

  const blank = useMemo((): Form | null => {
    if (!model) return null;
    const mix: MixRow[] = model.data.insurers.filter((i) => i.active).map((i) => ({
      key: i.id, name: i.name, share: 0, rate: i.defaultShare, delay: i.delayMonths, deduction: i.deductionRate,
    }));
    mix.push({ key: FREE_KEY, name: 'آزاد', share: 1, rate: 0, delay: 0, deduction: 0 });
    return {
      title: '', drugId: null, distributorId: null, price: 0, consumerPrice: 0, qty: 0, everyX: 0, freeY: 0, baseMonths: 3,
      discountPerMonth: 0, stock: 0, monthsToExpiry: 18, safetyMonths: 2, monthlyUse: 0, r: settings.monthlyRate, mix,
      normalPrice: 0, normalMonths: 3, normalQty: 0,
    };
  }, [model, settings.monthlyRate]);

  if (!model || !blank) return <PageSkeleton />;

  const { data, ctx, months, input } = model;
  const current = form ?? blank;
  const set = (patch: Partial<Form>) => setForm({ ...current, ...patch });

  const keepNormal = (patch: Partial<Form>) => {
    const next = { ...current, ...patch };
    // خرید عادی تا وقتی دستی عوض نشده، دنبال ورودی‌های آفر می‌رود.
    if (patch.price !== undefined && current.normalPrice === current.price) next.normalPrice = patch.price;
    if (patch.baseMonths !== undefined && current.normalMonths === current.baseMonths) next.normalMonths = patch.baseMonths;
    if (patch.monthlyUse !== undefined && current.normalQty === current.monthlyUse) next.normalQty = patch.monthlyUse;
    setForm(next);
  };

  const resolveDrugDefaults = (drug: Drug) => {
    const forecasts = data.doctors
      .filter((d) => d.active)
      .map((d) => forecastDoctor(d, data.profiles.filter((p) => p.doctorId === d.id), ctx));
    const monthlyUse = drugConsumption(forecasts, ctx).find((u) => u.drug.id === drug.id)?.use ?? 0;
    const latest = latestPurchases(data.items, data.invoices, data.distributors).find((p) => p.item.drugId === drug.id);
    const stock = lots.filter((l) => l.drugId === drug.id).reduce((s, l) => s + l.remaining, 0);
    return { monthlyUse, price: latest?.item.unitPrice ?? 0, stock };
  };

  const pickDrug = (drug: Drug) => {
    const forecasts = data.doctors
      .filter((d) => d.active)
      .map((d) => forecastDoctor(d, data.profiles.filter((p) => p.doctorId === d.id), ctx));
    const use = drugConsumption(forecasts, ctx).find((u) => u.drug.id === drug.id)?.use ?? 0;
    const latest = latestPurchases(data.items, data.invoices, data.distributors).find((p) => p.item.drugId === drug.id);
    const stock = lots.filter((l) => l.drugId === drug.id).reduce((s, l) => s + l.remaining, 0);

    // ترکیب بیمه از پزشکانی که این دارو را تجویز می‌کنند، با وزن مصرف
    const weights = new Map<number, number>();
    for (const f of forecasts) {
      const row = f.rows.find((x) => x.profile.drugId === drug.id);
      if (!row) continue;
      for (const part of f.byInsurer) weights.set(part.key, (weights.get(part.key) ?? 0) + row.use * part.share);
    }
    const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
    const mix = current.mix.map((row) => {
      const insurer = data.insurers.find((i) => i.id === row.key);
      const column = insurer
        ? insurerColumn(
            drug,
            insurer,
            data.coverage.find((c) => c.drugId === drug.id && c.insurerId === insurer.id),
            data.lists.find((l) => l.id === insurer.priceListId),
          )
        : null;
      return {
        ...row,
        share: totalWeight > 0 ? (weights.get(row.key) ?? 0) / totalWeight : row.share,
        rate: column && column.price > 0 ? column.share / column.price : row.rate,
      };
    });
    const price = latest?.item.unitPrice ?? current.price;
    setForm({
      ...current, title: drugTitle(drug), drugId: drug.id, price, normalPrice: price,
      consumerPrice: drug.price, stock, monthlyUse: use || current.monthlyUse, normalQty: use || current.normalQty, mix,
    });
  };

  const pickDistributor = (id: number) => {
    const row: Distributor | undefined = data.distributors.find((d) => d.id === id);
    if (!row) return set({ distributorId: null });
    setForm({
      ...current, distributorId: id, baseMonths: row.baseChequeMonths, normalMonths: row.baseChequeMonths,
      discountPerMonth: row.earlyPayDiscountPerMonth,
    });
  };

  const applySmartOfferText = (raw: string) => {
    setSmartText(raw);
    const parsed = parseOfferText(raw);
    const patch: Partial<Form> = {};
    if (parsed.buyQty !== undefined) {
      patch.qty = parsed.buyQty;
      patch.everyX = parsed.buyQty;
    }
    if (parsed.freeQty !== undefined) patch.freeY = parsed.freeQty;
    if (parsed.chequeMonths !== undefined) patch.baseMonths = parsed.chequeMonths;
    if (parsed.discountPerMonth !== undefined) patch.discountPerMonth = parsed.discountPerMonth;
    if (Object.keys(patch).length > 0) keepNormal(patch);
  };

  const mixOk = Math.abs(current.mix.reduce((s, r) => s + r.share, 0) - 1) < 0.0001;
  const ready = deferred && deferred.price > 0 && deferred.consumerPrice > 0 && deferred.qty > 0 && deferred.monthlyUse > 0
    && Math.abs(deferred.mix.reduce((s, r) => s + r.share, 0) - 1) < 0.0001;

  const offset = Math.max(0, months.findIndex((m) => m.key === currentMonthKey()));
  const cash: CashContext = {
    ends: months.map((m) => m.end),
    offset,
    minSafe: input.minSafe,
    active: input.streams.length > 0 || input.openingCash > 0,
  };

  const save = async (result: SavedResult) => {
    const title = normalizeText(current.title) || `آفر ${monthLabel(currentMonthKey())}`;
    await db.offers.add({ title, createdAt: new Date().toISOString(), input: current, result } as Offer);
    toast('ارزیابی ذخیره شد');
  };

  return (
    <>
      <PageHeader title="ارزیاب آفر" note="آیا خرید با این آفر به صرفه است، چه مقدار و با چه پرداختی؟" />

      <div className="mb-6">
        <Segmented<Tab>
          label="بخش‌های ارزیاب آفر"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'new', label: 'ارزیابی کامل' },
            { value: 'quick', label: 'مقایسهٔ سریع پیشنهادها' },
            { value: 'compare', label: `آفرهای ذخیره‌شده (${faNumber(offers.length)})` },
          ]}
        />
      </div>

      {tab === 'quick' && (
        <QuickCompare
          drugs={data.drugs}
          defaultRate={settings.monthlyRate}
          onResolveDrugDefaults={resolveDrugDefaults}
          onSendToFull={(row, qCtx, drug) => {
            if (drug) {
              pickDrug(drug);
            }
            setForm((prev) => {
              const base = prev ?? current;
              const price = qCtx.unitPrice > 0 ? qCtx.unitPrice : base.price;
              return {
                ...base,
                title: drug ? `${drugTitle(drug)} — ${row.title}` : row.title,
                drugId: drug ? drug.id : base.drugId,
                price,
                normalPrice: price,
                consumerPrice: drug ? drug.price : base.consumerPrice || price,
                qty: row.buyQty,
                everyX: row.buyQty,
                freeY: row.freeQty,
                baseMonths: row.chequeMonths,
                normalMonths: qCtx.normalMonths,
                discountPerMonth: row.discountPerMonth,
                monthlyUse: qCtx.monthlyUse || base.monthlyUse,
                normalQty: qCtx.monthlyUse || base.normalQty,
                monthsToExpiry: qCtx.monthsToExpiry,
                stock: qCtx.stock,
                r: qCtx.r,
              };
            });
            setTab('new');
          }}
        />
      )}

      {tab === 'compare' && (
        <Compare
          offers={[...offers].reverse()}
          onOpen={(offer) => {
            setForm(offer.input as Form);
            setTab('new');
          }}
        />
      )}

      {tab === 'new' && (
        <>
          <Card>
            <div className="grid gap-4 md:grid-cols-2">
              <DrugPicker drugs={data.drugs} onPick={pickDrug} />
              <Field label="شرکت پخش">
                {(id) => (
                  <SelectBox
                    id={id}
                    value={current.distributorId === null ? '' : String(current.distributorId)}
                    onChange={(v) => pickDistributor(Number(v))}
                    options={[{ value: '', label: 'انتخاب نشده' }, ...data.distributors.map((d) => ({ value: String(d.id), label: d.name }))]}
                  />
                )}
              </Field>
              <TextField label="عنوان ارزیابی" dir="auto" value={current.title} onChange={(e) => set({ title: e.target.value })} />
              <div>
                <label htmlFor="offer-smart-text" className="mb-1 flex items-center gap-2 text-note font-medium">
                  <Sparkles size={15} className="text-primary" aria-hidden />
                  <span>ورود متنی هوشمند آفر (اختیاری)</span>
                </label>
                <input
                  id="offer-smart-text"
                  type="text"
                  dir="auto"
                  placeholder="مثلاً: 100 عدد بخر 20 عدد آفر چک 6 ماهه"
                  value={smartText}
                  onChange={(e) => applySmartOfferText(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-line bg-app/50 px-4 text-ink"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <MoneyField label="قیمت خرید واحد (فی)" value={current.price} onChange={(price) => keepNormal({ price })} />
              <MoneyField label="قیمت مصرف‌کننده" value={current.consumerPrice} onChange={(consumerPrice) => set({ consumerPrice })} />
              <NumberField label="تعداد خرید" value={current.qty} onChange={(qty) => set({ qty })} />
              <NumberField label="مصرف ماهانه" value={current.monthlyUse} onChange={(monthlyUse) => keepNormal({ monthlyUse })} />
              <NumberField label="آفر: به ازای هر … عدد" value={current.everyX} onChange={(everyX) => set({ everyX })} />
              <NumberField label="آفر: … عدد رایگان" value={current.freeY} onChange={(freeY) => set({ freeY })} />
              <NumberField label="مدت چک پایه" suffix="ماه" value={current.baseMonths} onChange={(baseMonths) => keepNormal({ baseMonths: Math.round(baseMonths) })} />
              <PercentField label="تخفیف زودپرداخت در هر ماه" value={current.discountPerMonth} onChange={(discountPerMonth) => set({ discountPerMonth })} />
              <NumberField label="ماه تا انقضا" value={current.monthsToExpiry} onChange={(monthsToExpiry) => set({ monthsToExpiry })} />
              <NumberField label="موجودی فعلی" value={current.stock} onChange={(stock) => set({ stock })} />
              <PercentField label="هزینهٔ پول ماهانه" value={current.r} onChange={(r) => set({ r })} />
            </div>

            <div className="mt-4">
              <MixEditor mix={current.mix} onChange={(mix) => set({ mix })} />
            </div>

            <div className="mt-4">
              <MoreSettings>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <DateField
                    label="تاریخ انقضای بچ"
                    hint="ماه تا انقضا را پر می‌کند."
                    value={expiryDate}
                    onChange={(iso) => {
                      setExpiryDate(iso);
                      if (iso && parseJalaliDate(faDate(iso))) set({ monthsToExpiry: Math.round(monthsUntil(iso) * 10) / 10 });
                    }}
                  />
                  <NumberField label="حاشیهٔ امن انقضا" suffix="ماه" value={current.safetyMonths} onChange={(safetyMonths) => set({ safetyMonths })} />
                </div>
                <p className="text-note font-medium">سناریوی مبنا: خرید عادی</p>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <MoneyField label="قیمت خرید عادی" value={current.normalPrice} onChange={(normalPrice) => set({ normalPrice })} />
                  <NumberField label="مدت چک عادی" suffix="ماه" value={current.normalMonths} onChange={(normalMonths) => set({ normalMonths: Math.round(normalMonths) })} />
                  <NumberField label="خرید ماهانهٔ عادی" value={current.normalQty} onChange={(normalQty) => set({ normalQty })} />
                </div>
              </MoreSettings>
            </div>
            {!mixOk && <p className="mt-2 text-note text-muted">بعد از درست کردن ترکیب بیمه، نتیجه نشان داده می‌شود.</p>}
          </Card>

          {ready ? (
            <Results form={deferred} cash={cash} onSave={save} />
          ) : (
            <div className="mt-6">
              <EmptyState icon={BadgePercent} text="قیمت خرید، قیمت مصرف‌کننده، تعداد و مصرف ماهانه را وارد کنید تا حکم نشان داده شود." />
            </div>
          )}
        </>
      )}
    </>
  );
}

