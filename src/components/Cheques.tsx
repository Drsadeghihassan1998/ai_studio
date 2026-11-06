import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays } from 'lucide-react';
import { dueCheques } from '../lib/calc';
import { db, type Cheque } from '../lib/db';
import { faDate, faNumber } from '../lib/format';
import { addDays, jalaliParts, monthKey, monthLabel, todayISO } from '../lib/jalali';
import { normalizeText } from '../lib/text';
import { Badge, Button, Card, ConfirmButton, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { DateField, Field, MoneyField, SelectBox, TextField } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';

type Draft = Omit<Cheque, 'id' | 'dueDate'> & { id?: number; dueDate: string | null };

const monthOf = (iso: string) => {
  const { y, m } = jalaliParts(iso);
  return monthKey(y, m);
};

function ChequeForm({
  draft,
  distributors,
  onClose,
}: {
  draft: Draft;
  distributors: { id: number; name: string }[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(draft);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const valid = form.amount > 0 && form.dueDate && form.distributorId;

  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? 'ویرایش چک' : 'چک تازه'}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={async () => {
              await db.cheques.put({ ...form, note: normalizeText(form.note) } as Cheque);
              toast('چک ذخیره شد');
              onClose();
            }}
          >
            ذخیره
          </Button>
          {form.id && (
            <ConfirmButton
              label="حذف چک"
              question="این چک حذف شود؟"
              confirmLabel="حذف کن"
              onConfirm={async () => {
                await db.cheques.delete(form.id!);
                toast('چک حذف شد');
                onClose();
              }}
            />
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="شرکت پخش">
          {(id) => (
            <SelectBox
              id={id}
              value={String(form.distributorId || '')}
              onChange={(v) => set('distributorId')(Number(v))}
              options={[{ value: '', label: 'انتخاب کنید' }, ...distributors.map((d) => ({ value: String(d.id), label: d.name }))]}
            />
          )}
        </Field>
        <MoneyField label="مبلغ" value={form.amount} onChange={set('amount')} />
        <DateField label="سررسید" value={form.dueDate} onChange={set('dueDate')} />
        <TextField label="یادداشت" value={form.note ?? ''} onChange={(e) => set('note')(e.target.value)} />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={form.status === 'paid'}
            onChange={(e) => set('status')(e.target.checked ? 'paid' : 'pending')}
          />
          این چک پرداخت شده است
        </label>
      </div>
    </Drawer>
  );
}

export function Cheques() {
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [cheques, distributors] = await Promise.all([db.cheques.toArray(), db.distributors.toArray()]);
    return { cheques, distributors };
  });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  if (!data) return <PageSkeleton />;

  const today = todayISO();
  const nameOf = (id: number) => data.distributors.find((d) => d.id === id)?.name ?? '—';
  const pending = data.cheques.filter((c) => c.status === 'pending');
  const openTotal = pending.reduce((sum, c) => sum + c.amount, 0);
  const soon = dueCheques(data.cheques, addDays(today, 30));
  const overdue = pending.filter((c) => c.dueDate < today);

  const shown = (showPaid ? data.cheques : pending).slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const months = [...new Set(shown.map((c) => monthOf(c.dueDate)))];

  const blank: Draft = { distributorId: data.distributors[0]?.id ?? 0, amount: 0, dueDate: today, status: 'pending' };

  return (
    <>
      <PageHeader
        title="تقویم چک‌ها"
        note="چک‌ها به ترتیب سررسید، با جمع هر ماه."
        action={
          <Button variant="primary" onClick={() => setEditing(blank)}>
            افزودن چک
          </Button>
        }
      />

      {data.cheques.length === 0 ? (
        <EmptyState icon={CalendarDays} text="هنوز چکی ثبت نشده است. با ثبت فاکتور، چک آن خودکار اینجا می‌آید." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KeyCard label="جمع چک‌های پرداخت‌نشده" note={`${faNumber(pending.length)} چک`}>
              <Money rial={openTotal} big />
            </KeyCard>
            <KeyCard
              label="چک‌های ۳۰ روز آینده"
              note={`${faNumber(soon.items.length)} چک`}
              aside={
                <HowCalculated
                  title="چک‌های ۳۰ روز آینده"
                  formula="جمع چک‌های پرداخت‌نشده که سررسیدشان تا ۳۰ روز آینده است؛ چک‌های عقب‌افتاده هم حساب می‌شوند."
                  inputs={soon.items.map((c) => [faDate(c.dueDate), <Money rial={c.amount} exact />])}
                  result={['جمع', <Money rial={soon.total} exact />]}
                />
              }
            >
              <Money rial={soon.total} big />
            </KeyCard>
            <KeyCard label="چک‌های عقب‌افتاده">{faNumber(overdue.length)}</KeyCard>
          </div>

          <label className="mt-6 flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={showPaid}
              onChange={(e) => setShowPaid(e.target.checked)}
            />
            چک‌های پرداخت‌شده هم نشان داده شود
          </label>

          <div className="mt-2 grid gap-4">
            {months.map((month) => {
              const rows = shown.filter((c) => monthOf(c.dueDate) === month);
              const unpaid = rows.filter((c) => c.status === 'pending').reduce((sum, c) => sum + c.amount, 0);
              return (
                <Card key={month} flush>
                  <div className="flex items-center justify-between gap-2 px-6 py-4">
                    <h2 className="text-cardtitle font-medium">{monthLabel(month)}</h2>
                    <span className="font-bold"><Money rial={unpaid} /></span>
                  </div>
                  <ul>
                    {rows.map((cheque) => (
                      <li key={cheque.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-2">
                        <button type="button" onClick={() => setEditing(cheque)} className="min-h-11 min-w-0 flex-1 text-start">
                          <span className="flex flex-wrap items-center gap-2">
                            {nameOf(cheque.distributorId)}
                            {cheque.sample && <SampleBadge />}
                            {cheque.status === 'paid' && <Badge tone="good">پرداخت شد</Badge>}
                            {cheque.status === 'pending' && cheque.dueDate < today && <Badge tone="bad">عقب‌افتاده</Badge>}
                          </span>
                          <span className="block text-note text-muted">
                            سررسید {faDate(cheque.dueDate)}
                            {cheque.note ? `، ${cheque.note}` : ''}
                          </span>
                        </button>
                        <span className="flex items-center gap-4">
                          <Money rial={cheque.amount} />
                          {cheque.status === 'pending' && (
                            <Button
                              variant="text"
                              onClick={async () => {
                                await db.cheques.update(cheque.id, { status: 'paid' });
                                toast('چک پرداخت‌شده ثبت شد');
                              }}
                            >
                              پرداخت شد
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {editing && <ChequeForm draft={editing} distributors={data.distributors} onClose={() => setEditing(null)} />}
    </>
  );
}
