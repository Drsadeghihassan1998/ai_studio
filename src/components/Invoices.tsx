import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCopy, FileText, Search } from 'lucide-react';
import { db } from '../lib/db';
import { faDate, faNumber } from '../lib/format';
import { deleteInvoice, emptyDraft, loadDraft, parseInvoiceJson, type DraftInvoice } from '../lib/invoice';
import { INVOICE_PROMPT } from '../lib/invoicePrompt';
import { currentMonthKey, jalaliParts, monthKey } from '../lib/jalali';
import { matches } from '../lib/text';
import { Badge, Button, Card, ConfirmButton, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { InvoiceEditor } from './InvoiceEditor';

const monthOf = (iso: string) => {
  const { y, m } = jalaliParts(iso);
  return monthKey(y, m);
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function NewInvoice({ onClose, onDraft }: { onClose: () => void; onDraft: (draft: DraftInvoice) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const read = () => {
    const result = parseInvoiceJson(text);
    if (result.ok) onDraft(result.draft);
    else setErrors(result.errors);
  };

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title="فاکتور جدید"
      footer={
        <>
          <Button variant="primary" onClick={read}>
            بررسی و ادامه
          </Button>
          <Button variant="text" onClick={() => onDraft(emptyDraft())}>
            ورود دستی
          </Button>
        </>
      }
    >
      <ol className="grid gap-2 text-muted">
        <li>۱. پرامپت را کپی کنید.</li>
        <li>۲. آن را همراه PDF فاکتور به یک هوش مصنوعی بدهید.</li>
        <li>۳. خروجی JSON را اینجا بچسبانید.</li>
      </ol>
      <Button
        className="mt-4"
        onClick={async () => {
          if (await copyText(INVOICE_PROMPT)) toast('پرامپت کپی شد');
          else toast('کپی نشد. متن را از پایین همین صفحه بردارید.', 'error');
        }}
      >
        <ClipboardCopy size={16} aria-hidden /> کپی پرامپت استخراج
      </Button>
      <details className="mt-2">
        <summary className="flex min-h-11 items-center text-primary">دیدن متن پرامپت</summary>
        <pre dir="auto" className="rounded-xl bg-app p-4 text-note whitespace-pre-wrap">{INVOICE_PROMPT}</pre>
      </details>
      <label htmlFor="invoice-json" className="mt-4 mb-1 block text-note font-medium">
        خروجی هوش مصنوعی
      </label>
      <textarea
        id="invoice-json"
        dir="ltr"
        rows={10}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErrors([]);
        }}
        className="w-full rounded-xl border border-line bg-card p-4 text-note text-ink"
      />
      {errors.length > 0 && (
        <ul className="mt-2 grid gap-1 text-note text-bad" role="alert">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function Invoices() {
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [invoices, distributors, items] = await Promise.all([
      db.invoices.toArray(), db.distributors.toArray(), db.invoiceItems.toArray(),
    ]);
    return { invoices, distributors, items };
  });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftInvoice | null>(null);
  const [query, setQuery] = useState('');

  if (!data) return <PageSkeleton />;

  if (draft) return <InvoiceEditor key={draft.id ?? 'new'} initial={draft} onClose={() => setDraft(null)} />;

  const nameOf = (id: number) => data.distributors.find((d) => d.id === id)?.name ?? '—';
  const rows = data.invoices
    .filter((i) => matches(`${i.number} ${nameOf(i.distributorId)}`, query))
    .sort((a, b) => b.date.localeCompare(a.date));
  const thisMonth = data.invoices.filter((i) => monthOf(i.date) === currentMonthKey());
  const monthTotal = thisMonth.reduce((sum, i) => sum + i.payable, 0);
  const unmatched = data.items.filter((i) => i.drugId === null).length;

  return (
    <>
      <PageHeader
        title="فاکتورها"
        note="فاکتور خرید شرکت‌های پخش."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            فاکتور جدید
          </Button>
        }
      />

      {data.invoices.length === 0 ? (
        <EmptyState icon={FileText} text="هنوز فاکتوری ثبت نشده است. اولین فاکتور را با دکمهٔ «فاکتور جدید» وارد کنید." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KeyCard label="فاکتورهای ثبت‌شده">{faNumber(data.invoices.length)}</KeyCard>
            <KeyCard label="خرید این ماه"><Money rial={monthTotal} big /></KeyCard>
            <KeyCard label="اقلام وصل‌نشده به بانک">{faNumber(unmatched)}</KeyCard>
          </div>

          <Card flush className="mt-6">
            <div className="relative p-4">
              <Search size={18} className="absolute inset-y-0 start-8 my-auto text-muted" aria-hidden />
              <input
                type="search"
                aria-label="جستجوی فاکتور"
                placeholder="جستجو با شماره یا شرکت"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-line bg-card ps-12 pe-4 text-ink md:max-w-xs"
              />
            </div>
            <ul>
              {rows.map((invoice) => {
                const count = data.items.filter((i) => i.invoiceId === invoice.id).length;
                return (
                  <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4">
                    <button
                      type="button"
                      onClick={async () => setDraft(await loadDraft(invoice.id))}
                      className="min-w-0 flex-1 text-start"
                    >
                      <span className="flex flex-wrap items-center gap-2 font-medium text-primary">
                        {nameOf(invoice.distributorId)}
                        {invoice.sample && <SampleBadge />}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-note text-muted">
                        شمارهٔ {invoice.number || '—'}، {faDate(invoice.date)}، {faNumber(count)} قلم
                        {invoice.warnings?.length ? <Badge tone="warn">{faNumber(invoice.warnings.length)} هشدار</Badge> : null}
                      </span>
                    </button>
                    <span className="flex items-center gap-4">
                      <Money rial={invoice.payable} />
                      <ConfirmButton
                        label="حذف"
                        question="فاکتور و چک و بچ‌هایش حذف شود؟"
                        confirmLabel="حذف کن"
                        onConfirm={async () => {
                          await deleteInvoice(invoice.id);
                          toast('فاکتور حذف شد');
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            {rows.length === 0 && <p className="px-6 pb-6 text-muted">فاکتوری پیدا نشد.</p>}
          </Card>
        </>
      )}

      {creating && (
        <NewInvoice
          onClose={() => setCreating(false)}
          onDraft={(d) => {
            setCreating(false);
            setDraft(d);
          }}
        />
      )}
    </>
  );
}
