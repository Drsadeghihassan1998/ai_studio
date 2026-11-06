import { useDeferredValue, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCheck, Pill, Search, Tags, TrendingUp } from 'lucide-react';
import { db, type Coverage, type Drug } from '../lib/db';
import { mergeDrugs, STATUS_LABELS } from '../lib/drugbank';
import { FORM_FAMILIES } from '../lib/drugname';
import { faDate, faNumber } from '../lib/format';
import { go } from '../lib/route';
import { matchKey, normalizeText } from '../lib/text';
import {
  Badge, Button, Card, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge, Segmented,
} from './ui/basics';
import { SelectBox } from './ui/fields';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { DrugCard } from './DrugCard';
import { DrugForm } from './DrugForm';

type Tab = 'all' | 'review' | 'prices' | 'aliases';

const PAGE = 50;
const NO_LIST = 'بدون فهرست';

function useBank() {
  return useLiveQuery(async () => {
    const [drugs, coverage, insurers, lists, aliases, reviews, history] = await Promise.all([
      db.drugs.toArray(),
      db.coverage.toArray(),
      db.insurers.toArray(),
      db.priceLists.toArray(),
      db.drugAliases.toArray(),
      db.reviewItems.where('status').equals('open').toArray(),
      db.priceHistory.toArray(),
    ]);
    return { drugs, coverage, insurers, lists, aliases, reviews, history };
  });
}

type Bank = NonNullable<ReturnType<typeof useBank>>;

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search size={18} className="absolute inset-y-0 start-4 my-auto text-muted" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-xl border border-line bg-card ps-12 pe-4 text-ink"
      />
    </div>
  );
}

function AllDrugs({ bank, onOpen }: { bank: Bank; onOpen: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [insurer, setInsurer] = useState('');
  const [status, setStatus] = useState('');
  const [family, setFamily] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const deferred = useDeferredValue(query);

  const coverByDrug = useMemo(() => {
    const map = new Map<number, Coverage[]>();
    for (const c of bank.coverage) {
      const list = map.get(c.drugId);
      if (list) list.push(c);
      else map.set(c.drugId, [c]);
    }
    return map;
  }, [bank.coverage]);

  const aliasText = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of bank.aliases) map.set(a.drugId, `${map.get(a.drugId) ?? ''} ${matchKey(a.alias)}`);
    return map;
  }, [bank.aliases]);

  const visible = useMemo(() => {
    const words = matchKey(deferred).split(' ').filter(Boolean);
    return bank.drugs.filter((drug) => {
      const text = `${drug.searchText} ${aliasText.get(drug.id) ?? ''}`;
      if (!words.every((w) => text.includes(w))) return false;
      if (family && drug.formFamily !== family) return false;
      const covers = (coverByDrug.get(drug.id) ?? []).filter((c) => !insurer || String(c.insurerId) === insurer);
      if (insurer && covers.length === 0 && status !== NO_LIST) return false;
      if (status === NO_LIST) return covers.length === 0;
      if (status) return covers.some((c) => c.status === status);
      return true;
    });
  }, [bank.drugs, deferred, insurer, status, family, coverByDrug, aliasText]);

  const covers = (id: number) => coverByDrug.get(id) ?? [];
  const nameOfInsurer = (id: number) => bank.insurers.find((i) => i.id === id)?.name ?? '';

  return (
    <Card flush>
      <div className="grid gap-2 p-4 md:grid-cols-[1fr_repeat(3,176px)]">
        <SearchBox value={query} onChange={setQuery} label="جستجو با نام، کد یا نام تجاری" />
        <SelectBox
          label="فیلتر بیمه"
          value={insurer}
          onChange={setInsurer}
          options={[{ value: '', label: 'همهٔ بیمه‌ها' }, ...bank.insurers.map((i) => ({ value: String(i.id), label: i.name }))]}
        />
        <SelectBox
          label="فیلتر وضعیت تعهد"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'همهٔ وضعیت‌ها' },
            ...STATUS_LABELS.map((s) => ({ value: s, label: s === 'است' ? 'تعهد دارد' : s === 'نیست' ? 'تعهد ندارد' : s })),
            { value: NO_LIST, label: NO_LIST },
          ]}
        />
        <SelectBox
          label="فیلتر شکل دارویی"
          value={family}
          onChange={setFamily}
          options={[{ value: '', label: 'همهٔ شکل‌ها' }, ...FORM_FAMILIES.map((f) => ({ value: f, label: f }))]}
        />
      </div>
      <p className="px-6 pb-2 text-note text-muted">{faNumber(visible.length)} دارو</p>

      <ul>
        {visible.slice(0, limit).map((drug) => (
          <li key={drug.id} className="border-t border-line">
            <button
              type="button"
              onClick={() => onOpen(drug.id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 px-6 py-4 text-start hover:bg-app"
            >
              <span className="min-w-0">
                <span dir="auto" className="block font-medium">
                  {drug.genericName}
                  {drug.dose ? ` ${drug.dose}` : ''}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-note text-muted">
                  {drug.formFamily}
                  {drug.brandCode && <span>کد {drug.brandCode}</span>}
                  {drug.otc && <Badge>آزاد</Badge>}
                  {drug.sample && <SampleBadge />}
                  {covers(drug.id).map((c) => (
                    <Badge key={c.id} tone={c.status === 'است' ? 'good' : 'neutral'}>
                      {nameOfInsurer(c.insurerId)}
                    </Badge>
                  ))}
                </span>
              </span>
              {drug.price > 0 ? <Money rial={drug.price} exact /> : <span className="text-note text-muted">قیمت اعلام نشده</span>}
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="px-6 pb-6 text-muted">دارویی پیدا نشد.</p>}
      {visible.length > limit && (
        <div className="border-t border-line p-4 text-center">
          <Button variant="text" onClick={() => setLimit(limit + PAGE * 2)}>
            نمایش بیشتر
          </Button>
        </div>
      )}
    </Card>
  );
}

function ReviewTab({ bank, onOpen }: { bank: Bank; onOpen: (id: number) => void }) {
  const toast = useToast();
  const byId = useMemo(() => new Map(bank.drugs.map((d) => [d.id, d])), [bank.drugs]);

  if (bank.reviews.length === 0) {
    return <EmptyState icon={CheckCheck} text="موردی برای بررسی نیست." />;
  }

  const Side = ({ drug }: { drug?: Drug }) => (
    <button type="button" onClick={() => drug && onOpen(drug.id)} className="min-w-0 flex-1 rounded-xl border border-line p-4 text-start hover:bg-app">
      <span dir="auto" className="block font-medium">{drug?.names[0] ?? '—'}</span>
      <span className="text-note text-muted">
        {drug?.form} {drug?.dose} {drug?.brandCode ? `، کد ${drug.brandCode}` : ''}
      </span>
      <span className="mt-1 block">{drug && <Money rial={drug.price} exact />}</span>
    </button>
  );

  return (
    <div className="grid gap-4">
      {bank.reviews.map((item) => (
        <Card key={item.id}>
          <p className="mb-2 text-note text-muted">{item.reason}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Side drug={byId.get(item.drugId)} />
            <Side drug={byId.get(item.candidateId)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                const ok = await mergeDrugs(item.drugId, item.candidateId);
                if (ok) toast('دو دارو یکی شدند');
                else toast('هر دو در یک بیمه ردیف دارند و یکی نمی‌شوند. جدا نگه دارید.', 'error');
              }}
            >
              یکی هستند
            </Button>
            <Button variant="text" onClick={() => db.reviewItems.update(item.id, { status: 'separate' })}>
              جدا بمانند
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function PricesTab({ bank, onOpen }: { bank: Bank; onOpen: (id: number) => void }) {
  const lastBatch = bank.history.map((h) => h.batch).sort().at(-1);
  const rows = bank.history.filter((h) => h.batch === lastBatch);
  if (rows.length === 0) {
    return <EmptyState icon={TrendingUp} text="تغییر قیمتی ثبت نشده است. با ورود فهرست جدید، اینجا پر می‌شود." />;
  }
  const drug = (id: number) => bank.drugs.find((d) => d.id === id);
  return (
    <Card flush>
      <p className="p-6 text-muted">
        آخرین ورود فهرست، {faDate(lastBatch!.slice(0, 10))}: قیمت {faNumber(rows.length)} قلم عوض شد.
      </p>
      <ul>
        {rows.map((h) => (
          <li key={h.id} className="border-t border-line">
            <button
              type="button"
              onClick={() => onOpen(h.drugId)}
              className="flex w-full flex-wrap items-center justify-between gap-2 px-6 py-4 text-start hover:bg-app"
            >
              <span>
                <span dir="auto" className="block font-medium">{drug(h.drugId)?.genericName}</span>
                <span className="text-note text-muted">{bank.insurers.find((i) => i.id === h.insurerId)?.name}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Money rial={h.oldPrice} exact /> ← <Money rial={h.newPrice} exact />
                <Badge tone={h.newPrice > h.oldPrice ? 'warn' : 'good'}>
                  {faNumber(((h.newPrice - h.oldPrice) / h.oldPrice) * 100, 1)}٪
                </Badge>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AliasesTab({ bank, onOpen }: { bank: Bank; onOpen: (id: number) => void }) {
  const toast = useToast();
  const [alias, setAlias] = useState('');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const results = useMemo(() => {
    const words = matchKey(deferred).split(' ').filter(Boolean);
    if (words.length === 0) return [];
    return bank.drugs.filter((d) => words.every((w) => d.searchText.includes(w))).slice(0, 6);
  }, [bank.drugs, deferred]);

  const link = async (drugId: number) => {
    await db.drugAliases.add({ alias: normalizeText(alias), drugId } as never);
    setAlias('');
    setQuery('');
    toast('نام تجاری وصل شد');
  };

  return (
    <div className="grid gap-4">
      <Card>
        <p className="mb-4 text-muted">نام روی فاکتور را بنویسید و داروی ژنریک بانک را انتخاب کنید.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="نام تجاری"
            placeholder="نام تجاری، مثلاً اسویکس"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="min-h-11 rounded-xl border border-line bg-card px-4 text-ink"
          />
          <SearchBox value={query} onChange={setQuery} label="جستجوی داروی ژنریک" />
        </div>
        {results.length > 0 && (
          <ul className="mt-2">
            {results.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 border-t border-line py-2">
                <span dir="auto" className="min-w-0">{d.genericName} {d.dose}</span>
                <Button disabled={normalizeText(alias) === ''} onClick={() => link(d.id)}>
                  وصل کن
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {bank.aliases.length === 0 ? (
        <EmptyState icon={Tags} text="هنوز نام تجاری‌ای وصل نشده است." />
      ) : (
        <Card flush>
          <ul>
            {bank.aliases.map((a) => (
              <li key={a.id} className="border-b border-line last:border-0">
                <button type="button" onClick={() => onOpen(a.drugId)} className="flex w-full justify-between gap-2 px-6 py-4 text-start hover:bg-app">
                  <span className="font-medium">{a.alias}</span>
                  <span dir="auto" className="text-muted">{bank.drugs.find((d) => d.id === a.drugId)?.genericName}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function DrugBank() {
  const bank = useBank();
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<'new' | 'edit' | null>(null);

  const lastBatch = useMemo(() => bank?.history.map((h) => h.batch).sort().at(-1), [bank?.history]);

  if (!bank) return <PageSkeleton />;

  const open = bank.drugs.find((d) => d.id === openId);
  const covered = new Set(bank.coverage.filter((c) => c.status === 'است').map((c) => c.drugId)).size;
  const changed = bank.history.filter((h) => h.batch === lastBatch).length;
  const activeInsurers = bank.insurers;

  return (
    <>
      <PageHeader
        title="بانک دارو"
        note="داروها، قیمت‌ها و سهم هر بیمه کنار هم."
        action={
          <Button variant="primary" onClick={() => setForm('new')}>
            افزودن دارو
          </Button>
        }
      />

      {bank.drugs.length === 0 ? (
        <EmptyState
          icon={Pill}
          text="بانک دارو خالی است. فایل تعهد بیمه‌ها را وارد کنید تا داروها اینجا بیایند."
          action={<Button onClick={() => go('import')}>رفتن به مرکز ورود داده</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KeyCard label="داروهای بانک">{faNumber(bank.drugs.length)}</KeyCard>
            <KeyCard label="با تعهد بیمه">{faNumber(covered)}</KeyCard>
            <KeyCard label="نیاز به بررسی">{faNumber(bank.reviews.length)}</KeyCard>
            <KeyCard label="تغییر قیمت در آخرین ورود">{faNumber(changed)}</KeyCard>
          </div>

          <div className="my-6 overflow-x-auto">
            <Segmented<Tab>
              label="بخش‌های بانک دارو"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all', label: 'داروها' },
                { value: 'review', label: `نیاز به بررسی (${faNumber(bank.reviews.length)})` },
                { value: 'prices', label: 'تغییر قیمت' },
                { value: 'aliases', label: 'نام‌های تجاری' },
              ]}
            />
          </div>

          {tab === 'all' && <AllDrugs bank={bank} onOpen={setOpenId} />}
          {tab === 'review' && <ReviewTab bank={bank} onOpen={setOpenId} />}
          {tab === 'prices' && <PricesTab bank={bank} onOpen={setOpenId} />}
          {tab === 'aliases' && <AliasesTab bank={bank} onOpen={setOpenId} />}
        </>
      )}

      {open && !form && (
        <DrugCard
          drug={open}
          insurers={activeInsurers}
          coverage={bank.coverage.filter((c) => c.drugId === open.id)}
          lists={bank.lists}
          onClose={() => setOpenId(null)}
          onEdit={() => setForm('edit')}
        />
      )}
      {form && (
        <DrugForm
          drug={form === 'edit' ? open : undefined}
          insurers={bank.insurers}
          onClose={() => setForm(null)}
          onSaved={(id) => {
            setForm(null);
            setOpenId(id);
          }}
        />
      )}
    </>
  );
}
