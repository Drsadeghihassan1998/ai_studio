import { useMemo, useState } from 'react';
import { ArrowLeftRight, TriangleAlert } from 'lucide-react';
import {
  capitalNeeded, CAUSE_TEXT, chequeTermNeeded, DEFAULT_POLICY, firstWarning, invoiceMargin, lowestMonth, NO_STRESS, runCash,
  type CashInputs, type CashMonth, type CashPolicy, type Stress,
} from '../lib/cashflow';
import { updateSettings } from '../lib/db';
import { faDate, faNumber, faPercent, fullMoney } from '../lib/format';
import { jalaliParts, monthKey, monthLabel } from '../lib/jalali';
import { go } from '../lib/route';
import { useCashModel } from '../lib/useCashModel';
import {
  Badge, Button, Card, CardTitle, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge, Segmented,
} from './ui/basics';
import { Drawer } from './ui/Drawer';
import { Field, NumberField, PercentField, SelectBox } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { CashChart, SERIES, StackedBars, type StackSeries } from './Charts';
import { useSettings, useUnit } from './SettingsContext';

type Tab = 'cash' | 'insurers' | 'cheques' | 'pnl';

function PolicyForm({ policy, invoiceRate, onClose }: { policy: CashPolicy; invoiceRate: number | null; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(policy);
  const set = <K extends keyof CashPolicy>(key: K) => (value: CashPolicy[K]) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Drawer
      open
      onClose={onClose}
      title="سیاست خرید"
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            const horizon = Math.min(36, Math.max(12, Math.round(form.horizon)));
            await updateSettings({ cashPolicy: { ...form, horizon } });
            toast('سیاست خرید ذخیره شد');
            onClose();
          }}
        >
          ذخیره
        </Button>
      }
    >
      <div className="grid gap-4">
        <NumberField label="افق پیش‌بینی" suffix="ماه" hint="بین ۱۲ و ۳۶ ماه." value={form.horizon} onChange={set('horizon')} />
        <PercentField
          label="سهم خرید نقدی"
          hint={`بقیهٔ خرید (${faPercent(1 - form.cashShare)}) چکی است.`}
          value={form.cashShare}
          onChange={set('cashShare')}
        />
        <NumberField label="مدت چک پیش‌فرض" suffix="ماه" value={form.chequeMonths} onChange={set('chequeMonths')} />
        <NumberField label="موجودی نگه‌داشته" suffix="روز" value={form.stockDays} onChange={set('stockDays')} />
        <div>
          <p className="mb-1 text-note font-medium">درصد سود روی فروش</p>
          <Segmented<'invoice' | 'manual'>
            label="منبع درصد سود"
            value={form.marginFromInvoices ? 'invoice' : 'manual'}
            onChange={(v) => set('marginFromInvoices')(v === 'invoice')}
            options={[
              { value: 'invoice', label: 'از فاکتورها' },
              { value: 'manual', label: 'عدد دستی' },
            ]}
          />
          {form.marginFromInvoices && (
            <p className="mt-1 text-note text-muted">
              {invoiceRate === null ? 'هنوز فاکتوری نیست؛ عدد دستی پایین به کار می‌رود.' : `میانگین فاکتورها: ${faPercent(invoiceRate, 1)}`}
            </p>
          )}
        </div>
        {(!form.marginFromInvoices || invoiceRate === null) && (
          <PercentField label="درصد سود دستی" value={form.margin} onChange={set('margin')} />
        )}
      </div>
    </Drawer>
  );
}

function StressCard({ stress, onChange }: { stress: Stress; onChange: (s: Stress) => void }) {
  const active = stress.extraDelay > 0 || stress.salesDrop > 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-cardtitle font-medium">تست فشار</h2>
        {active && (
          <Button variant="text" className="min-h-9" onClick={() => onChange(NO_STRESS)}>
            برگشت به حالت عادی
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-note font-medium">همهٔ بیمه‌ها {faNumber(stress.extraDelay)} ماه تأخیر بیشتر</span>
          <input
            type="range"
            min={0}
            max={12}
            value={stress.extraDelay}
            onChange={(e) => onChange({ ...stress, extraDelay: Number(e.target.value) })}
            className="mt-2 block h-11 w-full accent-[var(--primary)]"
          />
        </label>
        <label className="block">
          <span className="text-note font-medium">فروش {faNumber(stress.salesDrop * 100)}٪ کمتر</span>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={stress.salesDrop * 100}
            onChange={(e) => onChange({ ...stress, salesDrop: Number(e.target.value) / 100 })}
            className="mt-2 block h-11 w-full accent-[var(--primary)]"
          />
        </label>
      </div>
    </Card>
  );
}

function MonthDetail({ month, onClose }: { month: CashMonth; onClose: () => void }) {
  const inflow: [string, number][] = [
    ['سهم بیمار از فروش', month.patientShare],
    ['سهم بیمار از حق فنی', month.feePatient],
    ['وصولی بیمه‌ها', month.collected],
  ];
  const outflow: [string, number][] = [
    ['خرید نقدی پیش‌بینی‌شده', month.cashPurchase],
    ['خرید نقدی ثبت‌شده', month.registeredCash],
    ['چک خرید پیش‌بینی‌شده', month.forecastCheque],
    ['چک‌های ثبت‌شده', month.registeredCheque],
    ['هزینه‌های ثابت', month.fixed],
    ['اجاره و کمک‌هزینهٔ پزشکان', month.doctorCosts],
    ['هزینه‌های یک‌باره', month.oneOff],
  ];
  const Rows = ({ rows }: { rows: [string, number][] }) => (
    <dl>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
          <dt className="text-muted">{label}</dt>
          <dd><Money rial={value} exact /></dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Drawer open onClose={onClose} title={`ماه ${faNumber(month.index)}: ${monthLabel(month.key)}`}>
      <div className="flex justify-between gap-4 py-2">
        <span className="text-muted">موجودی ابتدای ماه</span>
        <Money rial={month.start} exact />
      </div>
      <h3 className="mt-2 font-medium">پول ورودی: <Money rial={month.inflow} exact /></h3>
      <Rows rows={inflow} />
      <h3 className="mt-4 font-medium">پول خروجی: <Money rial={month.outflow} exact /></h3>
      <Rows rows={outflow} />
      <div className="flex justify-between gap-4 py-4 font-bold">
        <span>موجودی پایان ماه</span>
        <Money rial={month.end} exact />
      </div>
    </Drawer>
  );
}

function CashTab({ months, minSafe }: { months: CashMonth[]; minSafe: number }) {
  const [open, setOpen] = useState<CashMonth | null>(null);
  const limit = Math.max(0, minSafe);
  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle note="روی نمودار حرکت کنید تا مبلغ هر ماه را ببینید.">موجودی نقد پایان هر ماه</CardTitle>
        <CashChart months={months} minSafe={minSafe} />
      </Card>
      <Card flush>
        <div className="hidden grid-cols-4 gap-2 border-b border-line px-6 py-2 text-note text-muted md:grid">
          <span>ماه</span>
          <span>پول ورودی</span>
          <span>پول خروجی</span>
          <span>موجودی پایان ماه</span>
        </div>
        <ul>
          {months.map((m) => {
            const low = m.end < limit;
            return (
              <li key={m.key} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => setOpen(m)}
                  className="grid w-full grid-cols-2 gap-2 px-6 py-2 text-start hover:bg-app md:grid-cols-4"
                  style={low ? { background: 'color-mix(in srgb, var(--bad) 8%, transparent)' } : undefined}
                >
                  <span className="col-span-2 flex items-center gap-2 md:col-span-1">
                    <span className="text-muted">{faNumber(m.index)}</span>
                    {monthLabel(m.key)}
                    {m.end < 0 ? <Badge tone="bad">کسری</Badge> : low ? <Badge tone="warn">هشدار</Badge> : null}
                  </span>
                  <span className="text-note md:text-body"><span className="text-muted md:hidden">ورودی </span><Money rial={m.inflow} exact /></span>
                  <span className="text-note md:text-body"><span className="text-muted md:hidden">خروجی </span><Money rial={m.outflow} exact /></span>
                  <span className="col-span-2 font-medium md:col-span-1">
                    <span className="font-normal text-muted md:hidden">پایان ماه </span>
                    <Money rial={m.end} exact />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {open && <MonthDetail month={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function InsurersTab({ months, input }: { months: CashMonth[]; input: CashInputs }) {
  const unit = useUnit();
  const used = input.insurers.filter((i) => months.some((m) => m.receivable.has(i.key)));
  const series: StackSeries[] = used.slice(0, SERIES.length).map((i, n) => ({ key: i.key, name: i.name, color: SERIES[n] }));
  const rest = used.slice(SERIES.length).map((i) => i.key);
  const OTHER = -1;
  if (rest.length) series.push({ key: OTHER, name: 'سایر بیمه‌ها', color: 'var(--muted)' });
  const valueOf = (m: CashMonth, key: number) =>
    key === OTHER ? rest.reduce((s, k) => s + (m.receivable.get(k) ?? 0), 0) : (m.receivable.get(key) ?? 0);
  const collecting = months.filter((m) => m.collected > 0);

  if (used.length === 0) return <EmptyState icon={ArrowLeftRight} text="طلبی از بیمه‌ها پیش‌بینی نشده است." />;

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle note="طلب‌هایی که هنوز موعد وصولشان نرسیده است.">طلب انباشته از بیمه‌ها</CardTitle>
        <StackedBars months={months} series={series} valueOf={valueOf} label="نمودار انباشتهٔ طلب از بیمه‌ها" />
      </Card>
      <Card flush>
        <div className="px-6 pt-6"><CardTitle note="مبلغ بعد از کم شدن کسورات.">تقویم وصول</CardTitle></div>
        {collecting.length === 0 && <p className="px-6 pb-6 text-muted">در این افق وصولی پیش‌بینی نشده است.</p>}
        <ul>
          {collecting.map((m) => (
            <li key={m.key} className="flex flex-wrap items-start justify-between gap-2 border-t border-line px-6 py-2">
              <span>
                {monthLabel(m.key)}
                <span className="block text-note text-muted">
                  {[...m.collections].map(([k, v]) => `${input.insurers.find((i) => i.key === k)?.name}: ${fullMoney(v, unit)}`).join('، ')}
                </span>
              </span>
              <Money rial={m.collected} exact />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ChequesTab({
  months,
  cheques,
  nameOf,
}: {
  months: CashMonth[];
  cheques: { id: number; amount: number; dueDate: string; status: string; distributorId: number; sample?: boolean }[];
  nameOf: (id: number) => string;
}) {
  const monthOf = (iso: string) => {
    const { y, m } = jalaliParts(iso);
    return monthKey(y, m);
  };
  const rows = months.filter((m) => m.forecastCheque > 0 || m.registeredCheque > 0);
  if (rows.length === 0) return <EmptyState icon={ArrowLeftRight} text="در این افق چکی سررسید نمی‌شود." />;
  return (
    <div className="grid gap-4">
      {rows.map((m) => (
        <Card key={m.key} flush>
          <div className="flex items-center justify-between gap-2 px-6 py-4">
            <h2 className="text-cardtitle font-medium">{monthLabel(m.key)}</h2>
            <span className="font-bold"><Money rial={m.forecastCheque + m.registeredCheque} exact /></span>
          </div>
          <ul>
            {cheques
              .filter((c) => monthOf(c.dueDate) === m.key)
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    {nameOf(c.distributorId)}
                    {c.sample && <SampleBadge />}
                    <span className="text-note text-muted">سررسید {faDate(c.dueDate)}</span>
                  </span>
                  <Money rial={c.amount} exact />
                </li>
              ))}
            {m.forecastCheque > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-2">
                <span className="flex items-center gap-2">خرید پیش‌بینی‌شده <Badge>تخمین</Badge></span>
                <Money rial={m.forecastCheque} exact />
              </li>
            )}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function PnlTab({ months }: { months: CashMonth[] }) {
  const [key, setKey] = useState(months.find((m) => m.sales > 0)?.key ?? months[0].key);
  const month = months.find((m) => m.key === key) ?? months[0];
  const lines: [string, number][] = [
    ['فروش', month.sales],
    ['حق فنی', month.feeTotal],
    ['بهای تمام‌شده', -month.cogs],
    ['کسورات بیمه', -month.deductions],
    ['هزینه‌های ثابت', -month.fixed],
    ['اجاره و کمک‌هزینهٔ پزشکان', -month.doctorCosts],
  ];
  return (
    <div className="grid gap-4">
      <p className="rounded-xl bg-app p-4">
        سود، فروش همین ماه را می‌شمارد ولی پول نقد فقط وقتی می‌آید که بیمه پرداخت کند؛ برای همین ممکن است سود مثبت باشد و پول نقد کم بیاید.
      </p>
      <Card>
        <div className="mb-4 max-w-60">
          <Field label="ماه">
            {(id) => (
              <SelectBox
                id={id}
                value={key}
                onChange={setKey}
                options={months.map((m) => ({ value: m.key, label: monthLabel(m.key) }))}
              />
            )}
          </Field>
        </div>
        <dl>
          {lines.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">{label}</dt>
              <dd><Money rial={value} exact /></dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-2 font-bold">
            <dt className="flex items-center gap-4">
              سود خالص
              <HowCalculated
                title="سود خالص ماه (تعهدی)"
                formula="فروش + حق فنی − بهای تمام‌شده − کسورات بیمه − هزینه‌های ثابت (با اجاره و کمک‌هزینهٔ پزشکان). هزینهٔ یک‌باره اینجا نیست و فقط در نقدینگی حساب می‌شود."
                inputs={lines.map(([label, value]) => [label, <Money rial={value} exact />])}
                result={['سود خالص', <Money rial={month.netProfit} exact />]}
              />
            </dt>
            <dd><Money rial={month.netProfit} exact /></dd>
          </div>
        </dl>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle note="قبل از هزینه‌های ثابت داروخانه.">به تفکیک پزشک</CardTitle>
          <ul>
            {month.byDoctor.map((row) => (
              <li key={row.key} className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
                <span>
                  {row.name}
                  <span className="block text-note text-muted">فروش <Money rial={row.sales} inButton /></span>
                </span>
                <Money rial={row.net} exact />
              </li>
            ))}
          </ul>
          {month.byDoctor.length === 0 && <p className="text-muted">در این ماه فروشی نیست.</p>}
        </Card>
        <Card>
          <CardTitle>به تفکیک بیمه</CardTitle>
          <ul>
            {month.byInsurer.map((row) => (
              <li key={row.key} className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
                <span>
                  {row.name}
                  <span className="block text-note text-muted">سهم بیمه <Money rial={row.insurer} inButton />، کسورات <Money rial={row.deductions} inButton /></span>
                </span>
                <Money rial={row.sales} exact />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function Cashflow() {
  const settings = useSettings();
  const unit = useUnit();
  const model = useCashModel(settings);
  const [tab, setTab] = useState<Tab>('cash');
  const [stress, setStress] = useState<Stress>(NO_STRESS);
  const [editing, setEditing] = useState(false);

  const view = useMemo(() => {
    if (!model) return null;
    const months = runCash(model.input, stress);
    return {
      months,
      lowest: lowestMonth(months),
      warning: firstWarning(months, model.input),
      capital: capitalNeeded(months, model.input.minSafe),
      term: chequeTermNeeded(model.input, stress),
    };
  }, [model, stress]);

  if (!model || !view) return <PageSkeleton />;

  const { input, data } = model;
  const { months, lowest, warning, capital, term } = view;
  const policy = input.policy;
  const invoiceRate = invoiceMargin(data.items);
  const peak = months.reduce((a, b) => (b.receivableTotal > a.receivableTotal ? b : a), months[0]);
  const nameOf = (id: number) => data.distributors.find((d) => d.id === id)?.name ?? '—';
  const stressed = stress.extraDelay > 0 || stress.salesDrop > 0;
  const hasData = input.streams.length > 0 || input.fixed.length > 0 || input.cheques.length > 0;

  return (
    <>
      <PageHeader
        title="نقدینگی"
        note={`پیش‌بینی ${faNumber(policy.horizon)} ماه از ${monthLabel(input.startMonth)}.`}
        action={
          <Button variant="primary" onClick={() => setEditing(true)}>
            سیاست خرید
          </Button>
        }
      />

      {!hasData ? (
        <EmptyState
          icon={ArrowLeftRight}
          text="برای پیش‌بینی، اول پزشکان و هزینه‌های ثابت را وارد کنید."
          action={<Button onClick={() => go('doctors')}>رفتن به پزشکان</Button>}
        />
      ) : (
        <>
          {warning ? (
            <section className="mb-4 rounded-xl border border-bad/40 bg-card p-4">
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert size={18} className="mt-1 shrink-0 text-bad" aria-hidden />
                <span>
                  در ماه {faNumber(warning.month.index)} ({monthLabel(warning.month.key)}) حدود {fullMoney(Math.round(warning.gap), unit)}{' '}
                  {warning.level === 'short' ? 'کم می‌آورید' : 'زیر حداقل امن می‌روید'}. علت اصلی: {CAUSE_TEXT[warning.cause]}.
                </span>
              </p>
            </section>
          ) : (
            <p className="mb-4 rounded-xl bg-app p-4">در این افق هیچ ماهی زیر حداقل موجودی امن نمی‌رود.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KeyCard label="کمترین موجودی" note={monthLabel(lowest.key)}>
              <Money rial={lowest.end} big />
            </KeyCard>
            <KeyCard
              label="نزدیک‌ترین ماه کسری"
              note={warning ? `ماه ${faNumber(warning.month.index)}` : undefined}
            >
              {warning ? (
                <span className="text-cardtitle">{monthLabel(warning.month.key)}</span>
              ) : (
                <Badge tone="good">امن</Badge>
              )}
            </KeyCard>
            <KeyCard label="بیشترین طلب از بیمه‌ها" note={monthLabel(peak.key)}>
              <Money rial={peak.receivableTotal} big />
            </KeyCard>
            <KeyCard
              label="حداقل سرمایهٔ در گردش لازم"
              aside={
                <HowCalculated
                  title="حداقل سرمایهٔ در گردش لازم"
                  formula="حداقل موجودی امن − کمترین موجودی پایان ماه؛ پولی که باید به موجودی اول دوره اضافه شود."
                  inputs={[
                    ['حداقل موجودی امن', <Money rial={input.minSafe} exact />],
                    ['کمترین موجودی', <Money rial={lowest.end} exact />],
                  ]}
                  result={['سرمایهٔ لازم', <Money rial={capital} exact />]}
                />
              }
              note={
                term === null
                  ? 'با چک تا ۲۴ ماه هم حل نمی‌شود.'
                  : `یا چک دست‌کم ${faNumber(term)} ماهه (الان ${faNumber(policy.chequeMonths)} ماه)`
              }
            >
              <Money rial={capital} big />
            </KeyCard>
          </div>

          <div className="mt-4">
            <StressCard stress={stress} onChange={setStress} />
          </div>

          <div className="my-6 flex flex-wrap items-center gap-2 overflow-x-auto">
            <Segmented<Tab>
              label="بخش‌های نقدینگی"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'cash', label: 'ماه‌به‌ماه' },
                { value: 'insurers', label: 'طلب از بیمه' },
                { value: 'cheques', label: 'چک‌ها' },
                { value: 'pnl', label: 'سود و زیان' },
              ]}
            />
            {stressed && <Badge tone="warn">تست فشار روشن است</Badge>}
          </div>

          {tab === 'cash' && <CashTab months={months} minSafe={input.minSafe} />}
          {tab === 'insurers' && <InsurersTab months={months} input={input} />}
          {tab === 'cheques' && <ChequesTab months={months} cheques={data.cheques} nameOf={nameOf} />}
          {tab === 'pnl' && <PnlTab months={months} />}
        </>
      )}

      {editing && <PolicyForm policy={{ ...DEFAULT_POLICY, ...policy }} invoiceRate={invoiceRate} onClose={() => setEditing(false)} />}
    </>
  );
}
