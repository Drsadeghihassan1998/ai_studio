import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { db, type Coverage, type Drug, type Insurer, type PriceList } from '../lib/db';
import { deleteDrug, insurerColumn, type InsurerColumn } from '../lib/drugbank';
import { faDate, faNumber } from '../lib/format';
import { normalizeText } from '../lib/text';
import { Badge, Button, ConfirmButton, type Tone } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';

const toneOf = (status: string): Tone =>
  status === 'است' ? 'good' : status === 'نیست' || status === 'در فهرست نیست' ? 'bad' : status.startsWith('صرفاً') ? 'warn' : 'neutral';

function ShareCell({ column }: { column: InsurerColumn }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Money rial={column.share} exact />
      <span className="ms-1">
        <HowCalculated
          title={`سهم ${column.insurer.name}`}
          formula={column.formula}
          inputs={column.inputs.map(([label, value]) => [label, typeof value === 'number' ? <Money rial={value} exact /> : value])}
          result={['سهم سازمان', <Money rial={column.share} exact />]}
        />
      </span>
    </span>
  );
}

const ROWS: { label: string; cell: (c: InsurerColumn) => React.ReactNode }[] = [
  { label: 'قیمت مصرف‌کننده', cell: (c) => (c.price ? <Money rial={c.price} exact /> : 'قیمت اعلام نشده') },
  { label: 'سهم بیمه', cell: (c) => <ShareCell column={c} /> },
  { label: 'سهم بیمار', cell: (c) => <Money rial={c.patient} exact /> },
  {
    label: 'وضعیت تعهد',
    cell: (c) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={toneOf(c.status)}>{c.status}</Badge>
        {c.stale && <Badge tone="warn">در فهرست جدید نیست</Badge>}
      </span>
    ),
  },
  { label: 'بیمارستانی', cell: (c) => (c.hospital === undefined ? '—' : c.hospital ? 'بله' : 'خیر') },
  { label: 'سقف تجویز', cell: (c) => c.limit || '—' },
];

function Aliases({ drugId }: { drugId: number }) {
  const toast = useToast();
  const aliases = useLiveQuery(() => db.drugAliases.where('drugId').equals(drugId).toArray(), [drugId]) ?? [];
  const [text, setText] = useState('');

  const add = async () => {
    const alias = normalizeText(text);
    if (!alias) return;
    await db.drugAliases.add({ alias, drugId } as never);
    setText('');
    toast('نام تجاری وصل شد');
  };

  return (
    <section className="mt-6">
      <h3 className="mb-2 font-medium">نام‌های تجاری</h3>
      {aliases.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {aliases.map((a) => (
            <li key={a.id} className="flex items-center rounded-full border border-line ps-4">
              {a.alias}
              <button
                type="button"
                aria-label={`حذف ${a.alias}`}
                onClick={() => db.drugAliases.delete(a.id)}
                className="flex size-9 items-center justify-center text-muted"
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label="نام تجاری تازه"
          placeholder="مثلاً اسویکس"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-ink"
        />
        <Button type="submit" disabled={normalizeText(text) === ''}>
          وصل کن
        </Button>
      </form>
    </section>
  );
}

export function DrugCard({
  drug,
  insurers,
  coverage,
  lists,
  onClose,
  onEdit,
}: {
  drug: Drug;
  insurers: Insurer[];
  coverage: Coverage[];
  lists: PriceList[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const toast = useToast();
  const history = useLiveQuery(() => db.priceHistory.where('drugId').equals(drug.id).toArray(), [drug.id]) ?? [];
  const columns = insurers
    .filter((i) => i.active)
    .map((insurer) =>
      insurerColumn(
        drug,
        insurer,
        coverage.find((c) => c.insurerId === insurer.id),
        lists.find((l) => l.id === insurer.priceListId),
      ),
    );
  const notes = columns.filter((c) => c.conditions);

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={drug.genericName}
      footer={
        <>
          <Button onClick={onEdit}>ویرایش</Button>
          <ConfirmButton
            label="حذف دارو"
            question="این دارو و سهم‌هایش حذف شود؟"
            confirmLabel="حذف کن"
            onConfirm={async () => {
              await deleteDrug(drug.id);
              toast('دارو حذف شد');
              onClose();
            }}
          />
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['شکل', drug.form || drug.formFamily],
          ['دوز', drug.dose || '—'],
          ['کد برند', drug.brandCode || '—'],
          ['کد ژنریک', drug.genericCode || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-note text-muted">{label}</dt>
            <dd dir="auto" className="text-start">{value}</dd>
          </div>
        ))}
      </dl>
      {drug.names.length > 1 && (
        <p dir="ltr" className="mt-4 text-left text-note text-muted">
          {drug.names.slice(1).join(' • ')}
        </p>
      )}

      <h3 className="mt-6 mb-2 font-medium">مقایسهٔ بیمه‌ها</h3>
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line text-note text-muted">
              <td />
              {columns.map((c) => (
                <th key={c.insurer.id} scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">
                  {c.insurer.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-line last:border-0">
                <th scope="row" className="px-4 py-2 text-start text-note font-normal whitespace-nowrap text-muted">
                  {row.label}
                </th>
                {columns.map((c) => (
                  <td key={c.insurer.id} className="px-4 py-2 whitespace-nowrap">
                    {row.cell(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 md:hidden">
        {columns.map((c) => (
          <div key={c.insurer.id} className="rounded-xl border border-line p-4">
            <h4 className="mb-2 font-medium">{c.insurer.name}</h4>
            <dl>
              {ROWS.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-1">
                  <dt className="text-note text-muted">{row.label}</dt>
                  <dd>{row.cell(c)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {columns
        .filter((c) => c.options)
        .map((c) => (
          <p key={c.insurer.id} className="mt-2 text-note">
            سهم {c.insurer.name} بسته به شرایط فرق می‌کند:{' '}
            {c.options!.map((n, i) => (
              <span key={i}>
                {i > 0 && '، '}
                <Money rial={n} exact />
              </span>
            ))}
            . کمترین مبلغ در جدول آمده است.
          </p>
        ))}

      {notes.map((c) => (
        <p key={c.insurer.id} className="mt-2 text-note text-muted">
          شرایط تعهد {c.insurer.name}: {c.conditions}
        </p>
      ))}

      <Aliases drugId={drug.id} />

      {history.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 font-medium">تاریخچهٔ قیمت</h3>
          <ul className="text-note">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-2 py-1">
                <span className="text-muted">{faDate(h.date.slice(0, 10))}</span>
                <Money rial={h.oldPrice} exact /> ← <Money rial={h.newPrice} exact />
                <span className="text-muted">({faNumber(((h.newPrice - h.oldPrice) / h.oldPrice) * 100, 1)}٪)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Drawer>
  );
}
