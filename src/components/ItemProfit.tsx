import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Search, TrendingUp } from 'lucide-react';
import { average, lineFigures, marginHistogram, realProfit } from '../lib/calc';
import { db, type Coverage, type Insurer, type InvoiceItem, type PriceList } from '../lib/db';
import { insurerColumn } from '../lib/drugbank';
import { faDate, faNumber, faPercent } from '../lib/format';
import { latestPurchases, type PurchasedItem } from '../lib/invoice';
import { go } from '../lib/route';
import { matches } from '../lib/text';
import { Button, Card, CardTitle, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { SelectBox } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useSettings } from './SettingsContext';

type SortKey = 'name' | 'cost' | 'price' | 'sale' | 'purchase';

const figuresOf = (item: InvoiceItem) =>
  lineFigures({
    qty: item.quantity, bonus: item.bonus, unitPrice: item.unitPrice, discountPercent: item.discount,
    discountAmount: item.discountAmount, tax: item.tax, consumerPrice: item.consumerPrice,
  });

function Histogram({ margins }: { margins: number[] }) {
  const bins = marginHistogram(margins);
  const top = Math.max(...bins.map((b) => b.count), 1);
  return (
    <Card>
      <CardTitle note="تعداد اقلام در هر بازهٔ درصد سود روی فروش (بازه‌ها به درصد).">توزیع درصد سود روی فروش</CardTitle>
      <div className="flex h-44 items-end gap-2 border-b border-line" role="img" aria-label="نمودار توزیع درصد سود روی فروش">
        {bins.map((bin) => (
          <div key={bin.label} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="text-note text-muted">{bin.count > 0 ? faNumber(bin.count) : ''}</span>
            <span
              className="w-full max-w-8 rounded-t bg-primary"
              style={{ height: `${(bin.count / top) * 80}%`, minHeight: bin.count > 0 ? 4 : 0 }}
            />
            <span className="absolute bottom-full z-10 hidden rounded-lg border border-line bg-card px-2 py-1 text-note whitespace-nowrap text-ink shadow-card group-hover:block">
              {bin.label === 'زیان' ? bin.label : `${bin.label}٪`}: {faNumber(bin.count)} قلم
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {bins.map((bin) => (
          <span key={bin.label} className="min-w-0 flex-1 text-center text-note text-muted">
            {bin.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function ItemDetail({
  row,
  insurers,
  coverage,
  lists,
  onClose,
}: {
  row: PurchasedItem;
  insurers: Insurer[];
  coverage: Coverage[];
  lists: PriceList[];
  onClose: () => void;
}) {
  const settings = useSettings();
  const { item } = row;
  const f = figuresOf(item);
  const drug = useLiveQuery(async () => (item.drugId === null ? undefined : db.drugs.get(item.drugId)), [item.drugId]);
  const lots = useLiveQuery(
    () => (item.drugId === null ? [] : db.inventoryLots.where('drugId').equals(item.drugId).toArray()),
    [item.drugId],
  ) ?? [];

  const columns = insurers
    .filter((i) => i.active)
    .map((insurer) => {
      const column = insurerColumn(
        { price: item.consumerPrice, otc: drug?.otc ?? false },
        insurer,
        coverage.find((c) => c.drugId === item.drugId && c.insurerId === insurer.id),
        lists.find((l) => l.id === insurer.priceListId),
      );
      const profit = realProfit({
        patient: column.patient,
        insurer: column.share,
        deductionRate: insurer.deductionRate,
        delayMonths: insurer.delayMonths,
        r: settings.monthlyRate,
        unitCost: item.effectiveUnitCost,
      });
      return { insurer, column, profit };
    });

  return (
    <Drawer open wide onClose={onClose} title={item.name}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ['قیمت تمام‌شدهٔ هر واحد', <Money rial={f.unitCost} exact />],
          ['قیمت مصرف‌کننده', <Money rial={item.consumerPrice} exact />],
          ['سود هر واحد', <Money rial={f.unitProfit} exact />],
          ['درصد سود روی فروش', faPercent(f.marginOnSale)],
          ['درصد سود روی خرید', faPercent(f.marginOnCost)],
          ['سود کل قلم', <Money rial={f.totalProfit} exact />],
        ].map(([label, value], i) => (
          <div key={i}>
            <dt className="text-note text-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-note text-muted">
        آخرین خرید: {row.distributor}، {faDate(row.invoice.date)}، {faNumber(item.quantity)} عدد
        {item.bonus > 0 ? ` و ${faNumber(item.bonus)} بونوس` : ''}
      </p>

      <h3 className="mt-6 mb-2 font-medium">سود واقعی با احتساب تأخیر بیمه</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {columns.map(({ insurer, column, profit }) => (
          <div key={insurer.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium">{insurer.name}</h4>
              <HowCalculated
                title={`سود واقعی هر واحد، ${insurer.name}`}
                formula="سهم بیمار (الان نقد) + سهم بیمه × (۱ − کسورات) ÷ (۱ + r) به توان L − قیمت تمام‌شده"
                inputs={[
                  ['سهم بیمار', <Money rial={column.patient} exact />],
                  ['سهم بیمه', <Money rial={column.share} exact />],
                  ['کسورات', faPercent(insurer.deductionRate)],
                  ['تأخیر (L)', `${faNumber(insurer.delayMonths, 1)} ماه`],
                  ['هزینهٔ پول (r)', `${faPercent(settings.monthlyRate)} در ماه`],
                  ['ارزش امروز طلب بیمه', <Money rial={profit.today} exact />],
                  ['قیمت تمام‌شده', <Money rial={item.effectiveUnitCost} exact />],
                ]}
                result={['سود واقعی هر واحد', <Money rial={profit.real} exact />]}
              />
            </div>
            <dl className="mt-2">
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-note text-muted">سود اسمی هر واحد</dt>
                <dd><Money rial={profit.nominal} exact /></dd>
              </div>
              <div className="flex justify-between gap-4 py-1 font-bold">
                <dt className="text-note font-normal text-muted">سود واقعی هر واحد</dt>
                <dd><Money rial={profit.real} exact /></dd>
              </div>
            </dl>
            <p className="text-note text-muted">{column.status}</p>
          </div>
        ))}
      </div>

      {lots.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-medium">بچ‌ها</h3>
          <ul className="text-note">
            {lots.map((lot) => (
              <li key={lot.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2">
                <span dir="auto">بچ {lot.batch || '—'}، انقضا {lot.expiry || '—'}</span>
                <span className="text-muted">{faNumber(lot.remaining)} عدد، {lot.source}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'قلم' },
  { key: 'cost', label: 'قیمت تمام‌شده' },
  { key: 'price', label: 'قیمت مصرف‌کننده' },
  { key: 'sale', label: 'سود روی فروش' },
  { key: 'purchase', label: 'سود روی خرید' },
];

export function ItemProfit() {
  const data = useLiveQuery(async () => {
    const [items, invoices, distributors, insurers, coverage, lists] = await Promise.all([
      db.invoiceItems.toArray(), db.invoices.toArray(), db.distributors.toArray(), db.insurers.toArray(),
      db.coverage.toArray(), db.priceLists.toArray(),
    ]);
    return { items, invoices, distributors, insurers, coverage, lists };
  });
  const [query, setQuery] = useState('');
  const [distributor, setDistributor] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: 'sale', up: false });
  const [openKey, setOpenKey] = useState<string | null>(null);

  const all = useMemo(
    () => (data ? latestPurchases(data.items, data.invoices, data.distributors) : []),
    [data],
  );

  if (!data) return <PageSkeleton />;

  const visible = all
    .filter((r) => matches(r.item.name, query))
    .filter((r) => !distributor || String(r.invoice.distributorId) === distributor);

  const value = (r: PurchasedItem) =>
    sort.key === 'cost' ? r.item.effectiveUnitCost
    : sort.key === 'price' ? r.item.consumerPrice
    : sort.key === 'sale' ? r.item.marginOnSale
    : r.item.marginOnCost;
  const sorted = [...visible].sort((a, b) => {
    const result = sort.key === 'name' ? a.item.name.localeCompare(b.item.name, 'fa') : value(a) - value(b);
    return sort.up ? result : -result;
  });

  const margins = visible.map((r) => r.item.marginOnSale);
  const open = all.find((r) => r.key === openKey);
  const toggle = (key: SortKey) => setSort((s) => ({ key, up: s.key === key ? !s.up : key === 'name' }));
  const lowest = [...visible].sort((a, b) => a.item.marginOnSale - b.item.marginOnSale)[0];

  return (
    <>
      <PageHeader title="سود اقلام" note="آخرین قیمت تمام‌شده و درصد سود هر قلم خریداری‌شده." />

      {all.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          text="هنوز قلمی خریداری نشده است. با ثبت اولین فاکتور، سود اقلام اینجا می‌آید."
          action={<Button onClick={() => go('invoices')}>رفتن به فاکتورها</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KeyCard label="اقلام خریداری‌شده">{faNumber(visible.length)}</KeyCard>
            <KeyCard
              label="میانگین سود روی فروش"
              aside={
                <HowCalculated
                  title="میانگین سود روی فروش"
                  formula="میانگین سادهٔ درصد سود روی فروش اقلام همین فهرست، بدون وزن تعداد یا فروش"
                  inputs={[['تعداد اقلام', faNumber(margins.length)]]}
                  result={['میانگین', faPercent(average(margins))]}
                />
              }
            >
              {faPercent(average(margins), 1)}
            </KeyCard>
            <KeyCard label="کم‌سودترین قلم" note={lowest?.item.name}>
              {lowest ? faPercent(lowest.item.marginOnSale, 1) : '—'}
            </KeyCard>
          </div>

          <div className="mt-6">
            <Histogram margins={margins} />
          </div>

          <Card flush className="mt-6">
            <div className="grid gap-2 p-4 md:grid-cols-[1fr_220px]">
              <div className="relative">
                <Search size={18} className="absolute inset-y-0 start-4 my-auto text-muted" aria-hidden />
                <input
                  type="search"
                  aria-label="جستجوی قلم"
                  placeholder="جستجوی قلم"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-line bg-card ps-12 pe-4 text-ink"
                />
              </div>
              <SelectBox
                label="فیلتر شرکت پخش"
                value={distributor}
                onChange={setDistributor}
                options={[
                  { value: '', label: 'همهٔ شرکت‌ها' },
                  ...data.distributors.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
              />
            </div>

            <table className="hidden w-full md:table">
              <thead>
                <tr className="border-y border-line text-note text-muted">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={sort.key === c.key ? (sort.up ? 'ascending' : 'descending') : undefined}
                      className="sticky top-0 bg-card px-6 py-2 text-start font-medium"
                    >
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex min-h-9 items-center gap-1">
                        {c.label}
                        {sort.key === c.key && (sort.up ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.key} onClick={() => setOpenKey(r.key)} className="cursor-pointer border-b border-line last:border-0 hover:bg-app">
                    <td className="px-6 py-4">
                      <button type="button" dir="auto" className="text-start text-primary hover:underline">
                        {r.item.name}
                      </button>
                      <span className="mt-1 flex items-center gap-2 text-note text-muted">
                        {r.distributor}
                        {r.item.sample && <SampleBadge />}
                      </span>
                    </td>
                    <td className="px-6 py-4"><Money rial={r.item.effectiveUnitCost} exact /></td>
                    <td className="px-6 py-4"><Money rial={r.item.consumerPrice} exact /></td>
                    <td className={`px-6 py-4 ${r.item.marginOnSale < 0 ? 'text-bad' : ''}`}>{faPercent(r.item.marginOnSale, 1)}</td>
                    <td className={`px-6 py-4 ${r.item.marginOnCost < 0 ? 'text-bad' : ''}`}>{faPercent(r.item.marginOnCost, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="md:hidden">
              {sorted.map((r) => (
                <li key={r.key} className="border-t border-line">
                  <button type="button" onClick={() => setOpenKey(r.key)} className="w-full p-4 text-start">
                    <span dir="auto" className="block font-medium">{r.item.name}</span>
                    <span className="mt-1 block text-note text-muted">
                      تمام‌شده <Money rial={r.item.effectiveUnitCost} exact />، سود روی فروش {faPercent(r.item.marginOnSale, 1)}، سود روی خرید{' '}
                      {faPercent(r.item.marginOnCost, 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {sorted.length === 0 && <p className="px-6 pb-6 text-muted">قلمی پیدا نشد.</p>}
          </Card>
        </>
      )}

      {open && (
        <ItemDetail row={open} insurers={data.insurers} coverage={data.coverage} lists={data.lists} onClose={() => setOpenKey(null)} />
      )}
    </>
  );
}
