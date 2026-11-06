import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { db, type Coverage, type Drug, type PaymentType } from '../lib/db';
import { saveManualDrug } from '../lib/drugbank';
import { faNumber, faPercent } from '../lib/format';
import {
  buildMatchIndex, draftTotal, draftWarnings, emptyItem, fillPrice, lineOf, matchItem, newKey, payableOf, planCheques,
  saveInvoice, saveProblems, suggestDrugs, type DraftCheque, type DraftInvoice, type DraftItem, type MatchIndex,
} from '../lib/invoice';
import { matchKey, normalizeText } from '../lib/text';
import { Badge, Button, Card, CardTitle, PageHeader, PageSkeleton, Segmented } from './ui/basics';
import { DateField, MoneyField, NumberField, PercentField, TextField } from './ui/fields';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';

const PAYMENT_LABELS: { value: PaymentType; label: string }[] = [
  { value: 'cash', label: 'نقد' },
  { value: 'cheque', label: 'چک' },
  { value: 'mixed', label: 'ترکیبی' },
  { value: 'credit', label: 'نسیه' },
];

function DrugMatch({
  item,
  drugs,
  index,
  onChange,
}: {
  item: DraftItem;
  drugs: Map<number, Drug>;
  index: MatchIndex;
  onChange: (patch: Partial<DraftItem>) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const words = matchKey(query).split(' ').filter(Boolean);
    if (words.length === 0) return [];
    return index.drugs.filter((d) => words.every((w) => d.searchText.includes(w))).slice(0, 5);
  }, [query, index]);

  const choose = (drug: Drug) => {
    onChange({
      drugId: drug.id,
      matchedBy: 'confirmed',
      suggestions: [],
      consumerPrice: item.consumerPrice || drug.price,
    });
    setQuery('');
  };

  const matched = item.drugId === null ? undefined : drugs.get(item.drugId);
  if (matched) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-note">
        <Badge tone="good">{item.matchedBy === 'code' ? 'با کد' : item.matchedBy === 'alias' ? 'نام تأییدشده' : 'وصل شد'}</Badge>
        <span dir="auto">
          {item.name} ← {matched.genericName} {matched.dose}
        </span>
        <Button
          variant="text"
          className="min-h-9 px-2"
          onClick={() => onChange({ drugId: null, matchedBy: null, suggestions: suggestDrugs(item.name, item.strength, index) })}
        >
          تغییر
        </Button>
      </p>
    );
  }

  return (
    <div className="text-note">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">وصل نشده</Badge>
        {item.suggestions.map((s) => {
          const drug = drugs.get(s.drugId);
          return (
            drug && (
              <Button key={s.drugId} className="min-h-9 text-note" dir="auto" onClick={() => choose(drug)}>
                {drug.genericName} {drug.dose}
              </Button>
            )
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="جستجو در بانک دارو"
          placeholder="جستجو در بانک دارو"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-ink"
        />
        <Button
          variant="text"
          disabled={normalizeText(item.name) === ''}
          onClick={async () => {
            const id = await saveManualDrug({
              name: item.name, form: item.form, dose: item.strength, code: item.irc || item.genericCode,
              price: item.consumerPrice, otc: false, insurerId: null, coveredPrice: 0, shareRate: 0,
            });
            onChange({ drugId: id, matchedBy: 'manual', suggestions: [] });
            toast('داروی تازه به بانک اضافه شد');
          }}
        >
          داروی تازه بساز
        </Button>
      </div>
      {results.map((drug) => (
        <button
          key={drug.id}
          type="button"
          dir="auto"
          onClick={() => choose(drug)}
          className="block min-h-11 w-full border-b border-line py-2 text-start hover:text-primary"
        >
          {drug.genericName} {drug.dose} {drug.form}
        </button>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  number,
  drugs,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  number: number;
  drugs: Map<number, Drug>;
  index: MatchIndex;
  canRemove: boolean;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const f = lineOf(item);
  const set = <K extends keyof DraftItem>(key: K) => (value: DraftItem[K]) => onChange({ [key]: value });
  return (
    <div className="border-b border-line px-6 py-4 last:border-0">
      <div className="flex items-end gap-2">
        <span className="pb-2 text-note text-muted">{faNumber(number)}</span>
        <div className="min-w-0 flex-1">
          <TextField
            label="نام روی فاکتور"
            dir="auto"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value, unreadable: item.unreadable.filter((u) => u !== 'نام') })}
            onBlur={() => {
              if (item.drugId === null) onChange(matchItem(item, index));
            }}
          />
        </div>
        {canRemove && (
          <button
            type="button"
            aria-label={`حذف ردیف ${faNumber(number)}`}
            onClick={onRemove}
            className="flex size-11 shrink-0 items-center justify-center text-muted hover:text-bad"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-2">
        <DrugMatch item={item} drugs={drugs} index={index} onChange={onChange} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <NumberField label="تعداد" value={item.qty} onChange={set('qty')} />
        <NumberField label="بونوس" value={item.bonus} onChange={set('bonus')} />
        <MoneyField label="فی خرید" value={item.unitPrice} onChange={set('unitPrice')} />
        <PercentField label="تخفیف" value={item.discountPercent} onChange={set('discountPercent')} />
        <MoneyField label="مالیات کل سطر" value={item.tax} onChange={set('tax')} />
        <MoneyField label="قیمت مصرف‌کننده" value={item.consumerPrice} onChange={set('consumerPrice')} />
        <TextField label="بچ" dir="ltr" value={item.batch} onChange={(e) => set('batch')(e.target.value)} />
        <TextField label="انقضا" dir="ltr" value={item.expiry} onChange={(e) => set('expiry')(e.target.value)} />
        {item.discountAmount > 0 && <MoneyField label="مبلغ تخفیف" value={item.discountAmount} onChange={set('discountAmount')} />}
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-note">
        <div>
          <dt className="text-muted">قیمت تمام‌شدهٔ هر واحد</dt>
          <dd className="font-medium"><Money rial={f.unitCost} exact /></dd>
        </div>
        <div>
          <dt className="text-muted">سود روی فروش</dt>
          <dd className="font-medium">{faPercent(f.marginOnSale)}</dd>
        </div>
        <div>
          <dt className="text-muted">سود روی خرید</dt>
          <dd className="font-medium">{faPercent(f.marginOnCost)}</dd>
        </div>
        <div>
          <dt className="text-muted">سود هر واحد</dt>
          <dd className="font-medium"><Money rial={f.unitProfit} exact /></dd>
        </div>
        <div>
          <dt className="text-muted">سود کل قلم</dt>
          <dd className="font-medium"><Money rial={f.totalProfit} exact /></dd>
        </div>
        <div>
          <dt className="text-muted">جمع سطر</dt>
          <dd className="font-medium"><Money rial={f.paid} exact /></dd>
        </div>
      </dl>
    </div>
  );
}

function ChequeRows({
  draft,
  onChange,
}: {
  draft: DraftInvoice;
  onChange: (cheques: DraftCheque[]) => void;
}) {
  const update = (key: number, patch: Partial<DraftCheque>) =>
    onChange(draft.cheques.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const cash = payableOf(draft) - draft.cheques.reduce((sum, c) => sum + c.amount, 0);
  return (
    <div className="mt-4">
      {draft.cheques.map((cheque) => (
        <div key={cheque.key} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <MoneyField label="مبلغ چک" value={cheque.amount} onChange={(amount) => update(cheque.key, { amount })} />
          <DateField label="سررسید" value={cheque.dueDate} onChange={(dueDate) => update(cheque.key, { dueDate })} />
          <button
            type="button"
            aria-label="حذف چک"
            onClick={() => onChange(draft.cheques.filter((c) => c.key !== cheque.key))}
            className="flex size-11 items-center justify-center text-muted hover:text-bad"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="text"
          className="px-0"
          onClick={() =>
            onChange([...draft.cheques, { key: newKey(), amount: Math.max(0, Math.round(cash)), dueDate: draft.date, status: 'pending' }])
          }
        >
          <Plus size={16} aria-hidden /> افزودن چک
        </Button>
        {Math.abs(cash) > 1 && (
          <span className="text-note text-muted">
            پرداخت نقد: <Money rial={cash} exact />
          </span>
        )}
      </div>
    </div>
  );
}

export function InvoiceEditor({
  initial,
  onClose,
}: {
  initial: DraftInvoice;
  onClose: () => void;
}) {
  const toast = useToast();
  const bank = useLiveQuery(async () => {
    const [drugs, aliases, coverage, invoices, distributors] = await Promise.all([
      db.drugs.toArray(), db.drugAliases.toArray(), db.coverage.toArray(), db.invoices.toArray(), db.distributors.toArray(),
    ]);
    return { drugs, aliases, coverage, invoices, distributors };
  });
  const [draft, setDraft] = useState(initial);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const drugMap = useMemo(() => new Map((bank?.drugs ?? []).map((d) => [d.id, d])), [bank?.drugs]);
  const index = useMemo(() => buildMatchIndex(bank?.drugs ?? [], bank?.aliases ?? []), [bank?.drugs, bank?.aliases]);
  const coverageByDrug = useMemo(() => {
    const map = new Map<number, Coverage[]>();
    for (const c of bank?.coverage ?? []) map.set(c.drugId, [...(map.get(c.drugId) ?? []), c]);
    return map;
  }, [bank?.coverage]);

  // بار اول، سطرها با بانک تطبیق داده می‌شوند و چک پیشنهادی ساخته می‌شود.
  useEffect(() => {
    if (!bank || ready) return;
    setDraft((d) => ({
      ...d,
      items: d.items.map((item) => (item.name ? fillPrice(matchItem(item, index), drugMap) : item)),
    }));
    setReady(true);
  }, [bank, ready, index, drugMap]);

  // تا وقتی کاربر چک را دستی عوض نکرده، چک از شرایط پرداخت و جمع فاکتور ساخته می‌شود.
  const total = draftTotal(draft);
  useEffect(() => {
    if (draft.chequesEdited) return;
    setDraft((d) => ({ ...d, cheques: planCheques(d) }));
  }, [total, draft.filePayable, draft.date, draft.payment, draft.chequesEdited]);

  if (!bank) return <PageSkeleton />;

  const patchItem = (key: number, patch: Partial<DraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const patchPayment = (patch: Partial<DraftInvoice['payment']>) =>
    setDraft((d) => ({ ...d, payment: { ...d.payment, ...patch }, chequesEdited: false }));

  const distributor = bank.distributors.find((x) => matchKey(x.name) === matchKey(draft.distributor));
  const duplicate = bank.invoices.some(
    (i) => i.id !== draft.id && i.distributorId === distributor?.id && matchKey(i.number) === matchKey(draft.number) && draft.number !== '',
  );
  const warnings = draftWarnings(draft, drugMap, coverageByDrug, duplicate);
  const problems = saveProblems(draft);

  const save = async () => {
    setBusy(true);
    try {
      await saveInvoice(draft);
      toast('فاکتور ذخیره شد');
      onClose();
    } catch {
      toast('ذخیره انجام نشد. چیزی تغییر نکرد.', 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={draft.id ? 'ویرایش فاکتور' : 'فاکتور جدید'}
        note="سطرها را بررسی و اصلاح کنید، بعد ذخیره کنید."
        action={
          <div className="flex gap-2">
            <Button variant="text" onClick={onClose}>
              انصراف
            </Button>
            <Button variant="primary" disabled={busy || problems.length > 0} onClick={save}>
              ذخیرهٔ فاکتور
            </Button>
          </div>
        }
      />

      {warnings.length > 0 && (
        <section className="mb-4 rounded-xl border border-warn/40 bg-card p-4" aria-label="هشدارها">
          <h2 className="mb-2 flex items-center gap-2 font-medium">
            <TriangleAlert size={18} className="text-warn" aria-hidden />
            {faNumber(warnings.length)} هشدار
          </h2>
          <ul className="grid gap-1 text-note">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label="شرکت پخش"
            list="distributors"
            value={draft.distributor}
            onChange={(e) => setDraft({ ...draft, distributor: e.target.value })}
          />
          <datalist id="distributors">
            {bank.distributors.map((d) => (
              <option key={d.id} value={d.name} />
            ))}
          </datalist>
          <TextField label="شمارهٔ فاکتور" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} />
          <DateField label="تاریخ فاکتور" value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />
        </div>
      </Card>

      <Card flush className="mt-4">
        {draft.items.map((item, i) => (
          <ItemRow
            key={item.key}
            item={item}
            number={i + 1}
            drugs={drugMap}
            index={index}
            canRemove={draft.items.length > 1}
            onChange={(patch) => patchItem(item.key, patch)}
            onRemove={() => setDraft({ ...draft, items: draft.items.filter((x) => x.key !== item.key) })}
          />
        ))}
        <div className="border-t border-line px-6 py-2">
          <Button variant="text" className="px-0" onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}>
            <Plus size={16} aria-hidden /> افزودن سطر
          </Button>
        </div>
      </Card>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>شرایط پرداخت</CardTitle>
          <Segmented<PaymentType>
            label="نوع پرداخت"
            value={draft.payment.type}
            onChange={(type) => patchPayment({ type })}
            options={PAYMENT_LABELS}
          />
          {draft.payment.type !== 'cash' && (
            <>
              <div className="mt-4 max-w-40">
                <NumberField
                  label="مدت چک"
                  suffix="ماه"
                  value={draft.payment.chequeMonths ?? 0}
                  onChange={(chequeMonths) => patchPayment({ chequeMonths, dueDate: null })}
                />
              </div>
              <ChequeRows draft={draft} onChange={(cheques) => setDraft({ ...draft, cheques, chequesEdited: true })} />
            </>
          )}
        </Card>

        <Card>
          <CardTitle>جمع فاکتور</CardTitle>
          <dl>
            <div className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">جمع سطرها</dt>
              <dd><Money rial={total} exact /></dd>
            </div>
            {draft.filePayable !== null && (
              <div className="flex justify-between gap-4 border-b border-line py-2">
                <dt className="text-muted">جمع روی فاکتور</dt>
                <dd><Money rial={draft.filePayable} exact /></dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-2 font-bold">
              <dt>قابل پرداخت</dt>
              <dd><Money rial={payableOf(draft)} exact /></dd>
            </div>
          </dl>
          {problems.length > 0 && <p className="mt-2 text-note text-bad">{problems[0]}</p>}
        </Card>
      </div>
    </>
  );
}
