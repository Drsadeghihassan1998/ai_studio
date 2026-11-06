import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Stethoscope, Trash2 } from 'lucide-react';
import { db, type Doctor, type DoctorDrugProfile, type Drug, type Insurer } from '../lib/db';
import {
  buildContext, drugConsumption, forecastDoctor, mixProblem, newDoctor, SHIFT_LABEL, SOURCE_LABEL, totalsOf, WEEK_DAYS,
  type DoctorForecast, type ForecastContext, type ProfileRow, type Source,
} from '../lib/doctors';
import { faNumber, faPercent } from '../lib/format';
import { firstBelow, lowestMonth, runCash, streamOf, type CashInputs, type CashMonth } from '../lib/cashflow';
import { currentMonthKey, monthLabel } from '../lib/jalali';
import { useCashModel } from '../lib/useCashModel';
import { matchKey } from '../lib/text';
import {
  Badge, Button, Card, CardTitle, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge, Segmented,
} from './ui/basics';
import { Drawer } from './ui/Drawer';
import { Field, NumberField, PercentField, SelectBox } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { DoctorFields, DoctorForm, type DoctorDraft } from './DoctorForm';
import { useSettings } from './SettingsContext';

type Tab = 'doctors' | 'drugs';

const SourceBadge = ({ source }: { source: Source }) => (
  <Badge tone={source === 'actual' ? 'good' : 'neutral'}>{SOURCE_LABEL[source]}</Badge>
);

function DrugSearch({ drugs, onPick }: { drugs: Drug[]; onPick: (drug: Drug) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const words = matchKey(query).split(' ').filter(Boolean);
    if (words.length === 0) return [];
    return drugs.filter((d) => words.every((w) => d.searchText.includes(w))).slice(0, 5);
  }, [query, drugs]);
  return (
    <div>
      <input
        type="search"
        aria-label="جستجوی دارو در بانک"
        placeholder="افزودن دارو: جستجو با نام یا کد"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-line bg-card px-4 text-ink"
      />
      {results.map((drug) => (
        <button
          key={drug.id}
          type="button"
          dir="auto"
          onClick={() => {
            onPick(drug);
            setQuery('');
          }}
          className="block min-h-11 w-full border-b border-line py-2 text-start hover:text-primary"
        >
          {drug.genericName} {drug.dose} {drug.form}
        </button>
      ))}
    </div>
  );
}

/** ردیف پروفایل دارویی؛ در پزشک ثبت‌شده مستقیم ذخیره می‌شود و در سناریو فقط در حافظه می‌ماند. */
function ProfileEditor({
  rows,
  drugs,
  onAdd,
  onChange,
  onRemove,
}: {
  rows: ProfileRow[];
  drugs: Drug[];
  onAdd: (drug: Drug) => void;
  onChange: (index: number, patch: Partial<Pick<DoctorDrugProfile, 'rxShare' | 'qtyPerRx'>>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      {rows.map((row, i) => (
        <div key={row.profile.id ?? `${row.profile.drugId}-${i}`} className="border-b border-line py-2">
          <div className="flex items-center justify-between gap-2">
            <span dir="auto" className="min-w-0 font-medium">
              {row.drug ? `${row.drug.genericName} ${row.drug.dose ?? ''}` : 'داروی حذف‌شده'}
            </span>
            <button
              type="button"
              aria-label="حذف از پروفایل"
              onClick={() => onRemove(i)}
              className="flex size-11 shrink-0 items-center justify-center text-muted hover:text-bad"
            >
              <Trash2 size={18} aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <PercentField label="درصد نسخه‌های حاوی دارو" value={row.profile.rxShare} onChange={(rxShare) => onChange(i, { rxShare })} />
            <NumberField label="تعداد در هر نسخه" value={row.profile.qtyPerRx} onChange={(qtyPerRx) => onChange(i, { qtyPerRx })} />
            <div>
              <p className="mb-1 text-note font-medium">مصرف ماهانه</p>
              <p className="flex min-h-11 items-center font-bold">{faNumber(row.use, 1)} عدد</p>
            </div>
          </div>
          <p className="mt-1 text-note text-muted">
            سود این قلم {faPercent(row.margin, 1)}، {row.marginFromPurchase ? 'از آخرین خرید' : 'از میانگین تنظیمات'}
          </p>
        </div>
      ))}
      <div className="mt-2">
        <DrugSearch drugs={drugs} onPick={onAdd} />
      </div>
    </div>
  );
}

function Results({ forecast, ctx }: { forecast: DoctorForecast; ctx: ForecastContext }) {
  const f = forecast;
  const items: [string, React.ReactNode][] = [
    ['نسخه در ماه', `${faNumber(f.rx, 1)} نسخه`],
    ['فروش ماهانه', <Money rial={f.sales} exact />],
    ['سهم بیمه از فروش ماهانه', <Money rial={f.insurer} exact />],
    ['سهم بیمار از فروش ماهانه', <Money rial={f.patient} exact />],
    ['سود ناخالص', <Money rial={f.gross} exact />],
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={f.source} />
        <span className="text-note text-muted">
          {f.basis === 'average' ? 'فروش از میانگین مبلغ نسخه' : f.basis === 'profile' ? 'فروش از پروفایل دارویی و قیمت‌های بانک' : 'میانگین مبلغ نسخه یا پروفایل دارویی وارد نشده است'}
        </span>
      </div>
      <dl className="mt-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 py-2 font-bold">
          <dt className="flex items-center gap-4">
            سود خالص ماهانهٔ پزشک
            <HowCalculated
              title="سود خالص ماهانهٔ پزشک"
              formula="سود ناخالص − سهم داروخانه از اجارهٔ مطب − کمک‌هزینه"
              inputs={[
                ['نسخه در ماه', faNumber(f.rx, 1)],
                ['فروش ماهانه', <Money rial={f.sales} exact />],
                [f.basis === 'profile' ? 'درصد سود (میانگین اقلام)' : 'میانگین درصد سود', faPercent(f.margin, 1)],
                ['سود ناخالص', <Money rial={f.gross} exact />],
                ['سهم داروخانه از اجاره', <Money rial={f.rent} exact />],
                ['کمک‌هزینه', <Money rial={f.allowance} exact />],
              ]}
              result={['سود خالص', <Money rial={f.net} exact />]}
            />
          </dt>
          <dd><Money rial={f.net} exact /></dd>
        </div>
      </dl>

      {f.byInsurer.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-medium">فروش ماهانه به تفکیک بیمه</h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-note">
              <thead>
                <tr className="border-b border-line text-muted">
                  {['بیمه', 'سهم بیماران', 'فروش', 'سهم بیمه', 'سهم بیمار'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.byInsurer.map((row) => (
                  <tr key={row.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{row.name}</td>
                    <td className="px-4 py-2">{faPercent(row.share)}</td>
                    <td className="px-4 py-2 whitespace-nowrap"><Money rial={row.sales} exact /></td>
                    <td className="px-4 py-2 whitespace-nowrap"><Money rial={row.insurer} exact /></td>
                    <td className="px-4 py-2 whitespace-nowrap"><Money rial={row.patient} exact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ctx.margins.size === 0 && f.basis === 'profile' && (
        <p className="mt-2 text-note text-muted">هنوز فاکتوری ثبت نشده؛ سود از میانگین تنظیمات است.</p>
      )}
    </>
  );
}

function DoctorDetail({
  forecast,
  ctx,
  doctors,
  profiles,
  drugs,
  onClose,
  onEdit,
}: {
  forecast: DoctorForecast;
  ctx: ForecastContext;
  doctors: Doctor[];
  profiles: DoctorDrugProfile[];
  drugs: Drug[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const toast = useToast();
  const doctor = forecast.doctor as Doctor;
  const days = (doctor.weekDays ?? []).map((d) => WEEK_DAYS[d]).join('، ');
  const peers = doctors.filter(
    (d) => d.id !== doctor.id && matchKey(d.specialty) === matchKey(doctor.specialty) && profiles.some((p) => p.doctorId === d.id),
  );
  const [copyFrom, setCopyFrom] = useState('');
  const showBasis = forecast.averageSales > 0 && forecast.profileSales > 0;

  const copy = async () => {
    const source = profiles.filter((p) => p.doctorId === Number(copyFrom));
    const existing = new Set(forecast.rows.map((r) => r.profile.drugId));
    const fresh = source.filter((p) => !existing.has(p.drugId));
    await db.doctorDrugProfile.bulkAdd(
      fresh.map((p) => ({ doctorId: doctor.id, drugId: p.drugId, rxShare: p.rxShare, qtyPerRx: p.qtyPerRx })) as DoctorDrugProfile[],
    );
    toast(`${faNumber(fresh.length)} دارو کپی شد`);
    setCopyFrom('');
  };

  return (
    <Drawer open wide onClose={onClose} title={doctor.name} footer={<Button onClick={onEdit}>ویرایش پزشک</Button>}>
      <p className="mb-4 text-note text-muted">
        {doctor.specialty || 'بدون تخصص'}، {days || 'روز کاری انتخاب نشده'}، شیفت {SHIFT_LABEL[doctor.shift ?? 'both']}، {faNumber(doctor.workDays)} روز در ماه
      </p>

      <Results forecast={forecast} ctx={ctx} />

      {showBasis && (
        <div className="mt-4">
          <Field
            label="مبنای فروش"
            hint="پروفایل فقط داروهای پرتکرار را دارد و معمولاً از کل نسخه کمتر است."
          >
            {(id) => (
              <SelectBox
                id={id}
                value={forecast.basis}
                onChange={(v) => db.doctors.update(doctor.id, { salesBasis: v as 'average' | 'profile' })}
                options={[
                  { value: 'average', label: 'میانگین مبلغ نسخه' },
                  { value: 'profile', label: 'پروفایل دارویی و قیمت‌های بانک' },
                ]}
              />
            )}
          </Field>
        </div>
      )}

      <h3 className="mt-6 mb-2 font-medium">پروفایل دارویی</h3>
      <ProfileEditor
        rows={forecast.rows}
        drugs={drugs}
        onAdd={(drug) => {
          if (forecast.rows.some((r) => r.profile.drugId === drug.id)) toast('این دارو در پروفایل هست.', 'error');
          else db.doctorDrugProfile.add({ doctorId: doctor.id, drugId: drug.id, rxShare: 0.1, qtyPerRx: 1 } as DoctorDrugProfile);
        }}
        onChange={(i, patch) => db.doctorDrugProfile.update(forecast.rows[i].profile.id!, patch)}
        onRemove={(i) => db.doctorDrugProfile.delete(forecast.rows[i].profile.id!)}
      />

      {peers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="کپی پروفایل از پزشک هم‌تخصص">
              {(id) => (
                <SelectBox
                  id={id}
                  value={copyFrom}
                  onChange={setCopyFrom}
                  options={[{ value: '', label: 'انتخاب کنید' }, ...peers.map((d) => ({ value: String(d.id), label: d.name }))]}
                />
              )}
            </Field>
          </div>
          <Button disabled={copyFrom === ''} onClick={copy}>
            کپی کن
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function Scenario({
  ctx,
  insurers,
  doctors,
  profiles,
  drugs,
  current,
  cash,
  onClose,
}: {
  cash: CashInputs;
  ctx: ForecastContext;
  insurers: Insurer[];
  doctors: Doctor[];
  profiles: DoctorDrugProfile[];
  drugs: Drug[];
  current: DoctorForecast[];
  onClose: () => void;
}) {
  // این پروفایل فقط در حافظهٔ همین پنجره است و هیچ‌چیز از آن ذخیره نمی‌شود.
  const [draft, setDraft] = useState<DoctorDraft>({
    ...newDoctor(currentMonthKey()), name: 'پزشک فرضی', specialty: 'گوارش', rxPerDay: 30, avgRxAmount: 0,
  });
  const [lines, setLines] = useState<ProfileRow['profile'][]>([]);
  const forecast = forecastDoctor(draft, lines, ctx);
  const before = totalsOf(current);
  const problem = mixProblem(draft.insurerMix);
  const cashBefore = runCash(cash);
  const cashAfter = runCash({ ...cash, streams: [...cash.streams, streamOf(forecast, 'scenario')] });
  const shortAfter = firstBelow(cashAfter, Math.max(0, cash.minSafe));

  const fromDoctor = (id: string) =>
    setLines(profiles.filter((p) => p.doctorId === Number(id)).map(({ drugId, rxShare, qtyPerRx }) => ({ drugId, rxShare, qtyPerRx })));

  return (
    <Drawer open wide onClose={onClose} title="سناریوی پزشک جدید">
      <p className="mb-4 rounded-xl bg-app p-4 text-note">این سناریو موقت است و در داده‌های اصلی ذخیره نمی‌شود.</p>
      <DoctorFields scenario value={draft} insurers={insurers} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />

      <h3 className="mt-6 mb-2 font-medium">پروفایل دارویی فرضی</h3>
      {doctors.some((d) => profiles.some((p) => p.doctorId === d.id)) && (
        <div className="mb-2">
          <Field label="برداشتن پروفایل از یک پزشک">
            {(id) => (
              <SelectBox
                id={id}
                value=""
                onChange={fromDoctor}
                options={[
                  { value: '', label: 'انتخاب کنید' },
                  ...doctors.filter((d) => profiles.some((p) => p.doctorId === d.id)).map((d) => ({ value: String(d.id), label: d.name })),
                ]}
              />
            )}
          </Field>
        </div>
      )}
      <ProfileEditor
        rows={forecast.rows}
        drugs={drugs}
        onAdd={(drug) => setLines((l) => [...l, { drugId: drug.id, rxShare: 0.1, qtyPerRx: 1 }])}
        onChange={(i, patch) => setLines((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)))}
        onRemove={(i) => setLines((l) => l.filter((_, n) => n !== i))}
      />

      <h3 className="mt-6 mb-2 font-medium">اثر روی سود</h3>
      {problem ? (
        <p className="text-note text-bad">اول ترکیب بیمه را درست کنید.</p>
      ) : (
        <>
          <dl>
            {[
              ['سود خالص ماهانهٔ پزشکان فعلی', before.net],
              ['سود خالص این پزشک', forecast.net],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-4 border-b border-line py-2">
                <dt className="text-muted">{label}</dt>
                <dd><Money rial={value as number} exact /></dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 py-2 font-bold">
              <dt>سود خالص با این پزشک</dt>
              <dd><Money rial={before.net + forecast.net} exact /></dd>
            </div>
          </dl>
          <div className="mt-4">
            <Results forecast={forecast} ctx={ctx} />
          </div>
          <h3 className="mt-6 mb-2 font-medium">اثر روی نقدینگی</h3>
          <dl>
            {[
              ['کمترین موجودی فعلی', lowestMonth(cashBefore)],
              ['کمترین موجودی با این پزشک', lowestMonth(cashAfter)],
            ].map(([label, month]) => {
              const m = month as CashMonth;
              return (
                <div key={label as string} className="flex justify-between gap-4 border-b border-line py-2">
                  <dt className="text-muted">{label as string}</dt>
                  <dd><Money rial={m.end} exact /> <span className="text-note text-muted">{monthLabel(m.key)}</span></dd>
                </div>
              );
            })}
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-muted">نزدیک‌ترین ماه کسری با این پزشک</dt>
              <dd>{shortAfter ? monthLabel(shortAfter.key) : 'کمبودی نیست'}</dd>
            </div>
          </dl>
        </>
      )}
    </Drawer>
  );
}

function NetChart({ forecasts }: { forecasts: DoctorForecast[] }) {
  const sorted = [...forecasts].sort((a, b) => b.net - a.net);
  const top = Math.max(...sorted.map((f) => Math.abs(f.net)), 1);
  return (
    <Card>
      <CardTitle note="سود ناخالص نسخه‌ها منهای اجاره و کمک‌هزینه.">مقایسهٔ سود خالص ماهانهٔ پزشکان</CardTitle>
      <ul className="grid gap-2" aria-label="مقایسهٔ سود خالص پزشکان">
        {sorted.map((f) => (
          <li key={f.doctor.id} className="grid grid-cols-[minmax(0,160px)_1fr] items-center gap-2 md:grid-cols-[200px_1fr_140px]">
            <span className="truncate text-note">{f.doctor.name}</span>
            <span className="h-4">
              <span
                className={`block h-4 rounded-e ${f.net < 0 ? 'bg-bad' : 'bg-primary'}`}
                style={{ width: `${Math.max((Math.abs(f.net) / top) * 100, f.net === 0 ? 0 : 1)}%` }}
              />
            </span>
            <span className="col-span-2 text-end text-note md:col-span-1"><Money rial={f.net} /></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Doctors() {
  const settings = useSettings();
  const cashModel = useCashModel(settings);
  const data = useLiveQuery(async () => {
    const [doctors, profiles, drugs, coverage, insurers, lists, items, invoices, distributors, sales] = await Promise.all([
      db.doctors.toArray(), db.doctorDrugProfile.toArray(), db.drugs.toArray(), db.coverage.toArray(), db.insurers.toArray(),
      db.priceLists.toArray(), db.invoiceItems.toArray(), db.invoices.toArray(), db.distributors.toArray(), db.sales.toArray(),
    ]);
    return { doctors, profiles, drugs, coverage, insurers, lists, items, invoices, distributors, sales };
  });
  const [tab, setTab] = useState<Tab>('doctors');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<DoctorDraft | null>(null);
  const [scenario, setScenario] = useState(false);

  const model = useMemo(() => {
    if (!data) return null;
    const ctx = buildContext({ ...data, settings });
    const forecasts = data.doctors.map((d) => forecastDoctor(d, data.profiles.filter((p) => p.doctorId === d.id), ctx));
    const active = forecasts.filter((f) => f.doctor.active);
    return { ctx, forecasts, active, totals: totalsOf(active), use: drugConsumption(active, ctx) };
  }, [data, settings]);

  if (!data || !model || !cashModel) return <PageSkeleton />;

  const { ctx, forecasts, active, totals, use } = model;
  const open = forecasts.find((f) => f.doctor.id === openId);
  const allActual = active.length > 0 && active.every((f) => f.source === 'actual');
  const source: Source = allActual ? 'actual' : 'manual';

  return (
    <>
      <PageHeader
        title="پزشکان"
        note="پیش‌بینی نسخه، فروش و سود هر پزشک."
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setScenario(true)}>سناریوی پزشک جدید</Button>
            <Button variant="primary" onClick={() => setEditing(newDoctor(currentMonthKey()))}>
              پزشک جدید
            </Button>
          </div>
        }
      />

      {data.doctors.length === 0 ? (
        <EmptyState icon={Stethoscope} text="هنوز پزشکی ثبت نشده است. اولین پزشک را اضافه کنید یا در تنظیمات داده‌های نمونه را بیاورید." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KeyCard label="نسخهٔ ماهانهٔ پزشکان فعال" note={<SourceBadge source={source} />}>
              {faNumber(totals.rx)}
            </KeyCard>
            <KeyCard label="فروش ماهانه" note={<SourceBadge source={source} />}>
              <Money rial={totals.sales} big />
            </KeyCard>
            <KeyCard
              label="سود خالص ماهانه"
              note={<SourceBadge source={source} />}
              aside={
                <HowCalculated
                  title="سود خالص ماهانهٔ پزشکان"
                  formula="جمع سود خالص پزشکان فعال. هزینه‌های ثابت داروخانه اینجا کم نشده است."
                  inputs={active.map((f) => [f.doctor.name, <Money rial={f.net} exact />])}
                  result={['جمع', <Money rial={totals.net} exact />]}
                />
              }
            >
              <Money rial={totals.net} big />
            </KeyCard>
          </div>

          <div className="my-6">
            <Segmented<Tab>
              label="بخش‌های پزشکان"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'doctors', label: 'پزشکان' },
                { value: 'drugs', label: 'مصرف ماهانهٔ دارو' },
              ]}
            />
          </div>

          {tab === 'doctors' && (
            <div className="grid gap-4">
              {active.length > 0 && <NetChart forecasts={active} />}
              <Card flush>
                <ul>
                  {forecasts.map((f) => (
                    <li key={f.doctor.id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        onClick={() => setOpenId(f.doctor.id!)}
                        className="flex w-full flex-wrap items-center justify-between gap-2 px-6 py-4 text-start hover:bg-app"
                      >
                        <span>
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            {f.doctor.name}
                            {(f.doctor as Doctor).sample && <SampleBadge />}
                            {!f.doctor.active && <Badge>غیرفعال</Badge>}
                            {Object.keys(f.doctor.insurerMix).some((k) => Number(k) !== 0 && !ctx.insurers.has(Number(k))) && (
                              <Badge tone="bad">بیمهٔ حذف‌شده در ترکیب</Badge>
                            )}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-note text-muted">
                            {f.doctor.specialty}، {faNumber(f.rx)} نسخه در ماه
                            <SourceBadge source={f.source} />
                          </span>
                        </span>
                        <span className="text-end">
                          <span className="block text-note text-muted">فروش <Money rial={f.sales} inButton /></span>
                          <span className="block font-medium">سود خالص <Money rial={f.net} inButton /></span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {tab === 'drugs' &&
            (use.length === 0 ? (
              <EmptyState icon={Stethoscope} text="هنوز دارویی در پروفایل پزشکان نیست. پزشکی را باز کنید و داروهای پرتکرارش را اضافه کنید." />
            ) : (
              <Card flush>
                <ul>
                  {use.map((row) => (
                    <li key={row.drug.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-4 last:border-0">
                      <span className="min-w-0">
                        <span dir="auto" className="block font-medium">{row.drug.genericName} {row.drug.dose}</span>
                        <span className="text-note text-muted">{row.doctors.map((d) => d.name).join('، ')}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <SourceBadge source={row.source} />
                        <span className="font-bold">{faNumber(row.use, 1)} عدد در ماه</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </>
      )}

      {open && !editing && (
        <DoctorDetail
          forecast={open}
          ctx={ctx}
          doctors={data.doctors}
          profiles={data.profiles}
          drugs={data.drugs}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open.doctor)}
        />
      )}
      {editing && <DoctorForm key={editing.id ?? 'new'} draft={editing} insurers={data.insurers} onClose={() => setEditing(null)} />}
      {scenario && (
        <Scenario
          ctx={ctx}
          insurers={data.insurers}
          doctors={data.doctors}
          profiles={data.profiles}
          drugs={data.drugs}
          current={active}
          cash={cashModel.input}
          onClose={() => setScenario(false)}
        />
      )}
    </>
  );
}
