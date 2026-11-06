import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, ShieldCheck } from 'lucide-react';
import { average } from '../lib/calc';
import { db, newInsurer, type Insurer } from '../lib/db';
import { faNumber, faPercent } from '../lib/format';
import { matches, normalizeText } from '../lib/text';
import {
  Badge, Button, Card, ConfirmButton, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge,
} from './ui/basics';
import { Drawer } from './ui/Drawer';
import type { ShareBase } from '../lib/calc';
import { SHARE_BASE_LABEL } from '../lib/drugbank';
import { Field, MoreSettings, NumberField, PercentField, SelectBox, TextField } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { useToast } from './ui/Toast';

type Draft = Omit<Insurer, 'id'> & { id?: number };

function InsurerForm({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(draft);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));

  const list = useLiveQuery(async () => (form.priceListId ? db.priceLists.get(form.priceListId) : undefined), [form.priceListId]);
  const [shareBase, setShareBase] = useState<ShareBase | null>(null);

  const save = async () => {
    const row = { ...form, name: form.name.trim() };
    if (row.id) await db.insurers.put(row as Insurer);
    else await db.insurers.add(row as Insurer);
    if (list && shareBase) await db.priceLists.update(list.id, { shareBase });
    toast('بیمه ذخیره شد');
    onClose();
  };

  const remove = async () => {
    const users = (await db.doctors.toArray()).filter((d) => (d.insurerMix[form.id!] ?? 0) > 0);
    if (users.length > 0) {
      toast(`این بیمه در ترکیب ${users.map((d) => d.name).join('، ')} است. اول آن را از ترکیب پزشک بردارید.`, 'error');
      return;
    }
    await db.transaction('rw', db.insurers, db.coverage, db.priceLists, async () => {
      await db.coverage.where('insurerId').equals(form.id!).delete();
      await db.priceLists.where('insurerId').equals(form.id!).delete();
      await db.insurers.delete(form.id!);
    });
    toast('بیمه حذف شد');
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? form.name : 'بیمهٔ تازه'}
      footer={
        <>
          <Button variant="primary" disabled={normalizeText(form.name) === ''} onClick={save}>
            ذخیره
          </Button>
          {form.id && (
            <ConfirmButton label="حذف بیمه" question="این بیمه حذف شود؟" confirmLabel="حذف کن" onConfirm={remove} />
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="نام بیمه" value={form.name} onChange={(e) => set('name')(e.target.value)} />
        <NumberField
          label="تأخیر وصول"
          suffix="ماه"
          hint="تعداد ماه از فروش تا وصول. مقدار دقیق که معلوم شد، همین‌جا اصلاحش کنید."
          value={form.delayMonths}
          onChange={set('delayMonths')}
        />
        <PercentField
          label="کسورات"
          hint="درصدی از طلب که بیمه پرداخت نمی‌کند."
          value={form.deductionRate}
          onChange={set('deductionRate')}
        />
        {list && (
          <Field
            label="پایهٔ محاسبهٔ سهم"
            hint={`فهرست: ${list.fileName}. اگر فایل مبلغ سهم را مستقیم داده باشد، همان مبلغ استفاده می‌شود.`}
          >
            {(id) => (
              <SelectBox
                id={id}
                value={shareBase ?? list.shareBase}
                onChange={(v) => setShareBase(v as ShareBase)}
                options={Object.entries(SHARE_BASE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            )}
          </Field>
        )}
        <MoreSettings>
          <PercentField
            label="سهم پیش‌فرض بیمه"
            hint="فقط برای بیمه‌ای که فهرست قیمت ندارد."
            value={form.defaultShare}
            onChange={set('defaultShare')}
          />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={form.active}
              onChange={(e) => set('active')(e.target.checked)}
            />
            این بیمه فعال است
          </label>
        </MoreSettings>
      </div>
    </Drawer>
  );
}

const months = (n: number) => `${faNumber(n, 1)} ماه`;

const StatusBadge = ({ insurer }: { insurer: Insurer }) => (
  <span className="flex gap-1">
    <Badge tone={insurer.active ? 'good' : 'neutral'}>{insurer.active ? 'فعال' : 'غیرفعال'}</Badge>
    {insurer.sample && <SampleBadge />}
  </span>
);

export function Insurers() {
  const insurers = useLiveQuery(() => db.insurers.toArray());
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);

  if (!insurers) return <PageSkeleton />;

  const active = insurers.filter((i) => i.active);
  const visible = insurers.filter((i) => matches(i.name, query));
  const avgDelay = average(active.map((i) => i.delayMonths));
  const avgDeduction = average(active.map((i) => i.deductionRate));

  return (
    <>
      <PageHeader
        title="بیمه‌ها"
        note="تأخیر وصول و کسورات هر بیمه."
        action={
          <Button variant="primary" onClick={() => setEditing(newInsurer(''))}>
            افزودن بیمه
          </Button>
        }
      />

      {insurers.length === 0 ? (
        <EmptyState icon={ShieldCheck} text="هنوز بیمه‌ای ثبت نشده است. اولین بیمه را اضافه کنید." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KeyCard label="بیمه‌های فعال">{faNumber(active.length)}</KeyCard>
            <KeyCard
              label="میانگین تأخیر وصول"
              aside={
                <HowCalculated
                  title="میانگین تأخیر وصول"
                  formula="جمع تأخیر بیمه‌های فعال ÷ تعداد آن‌ها (میانگین ساده، بدون وزن فروش)"
                  inputs={active.map((i) => [i.name, months(i.delayMonths)])}
                  result={['میانگین', months(avgDelay)]}
                />
              }
            >
              {months(avgDelay)}
            </KeyCard>
            <KeyCard
              label="میانگین کسورات"
              aside={
                <HowCalculated
                  title="میانگین کسورات"
                  formula="جمع کسورات بیمه‌های فعال ÷ تعداد آن‌ها (میانگین ساده، بدون وزن فروش)"
                  inputs={active.map((i) => [i.name, faPercent(i.deductionRate)])}
                  result={['میانگین', faPercent(avgDeduction)]}
                />
              }
            >
              {faPercent(avgDeduction)}
            </KeyCard>
          </div>

          <Card className="mt-6" flush>
            <div className="relative p-4">
              <Search size={18} className="absolute inset-y-0 start-8 my-auto text-muted" aria-hidden />
              <input
                type="search"
                aria-label="جستجوی بیمه"
                placeholder="جستجوی بیمه"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-line bg-card ps-12 pe-4 text-ink md:max-w-xs"
              />
            </div>

            {visible.length === 0 && <p className="px-6 pb-6 text-muted">بیمه‌ای با این نام پیدا نشد.</p>}

            <table className="hidden w-full text-start md:table">
              {visible.length > 0 && (
                <thead>
                  <tr className="border-y border-line text-note text-muted">
                    <th scope="col" className="sticky top-0 bg-card px-6 py-2 text-start font-medium">نام بیمه</th>
                    <th scope="col" className="sticky top-0 bg-card px-6 py-2 text-start font-medium">تأخیر وصول</th>
                    <th scope="col" className="sticky top-0 bg-card px-6 py-2 text-start font-medium">کسورات</th>
                    <th scope="col" className="sticky top-0 bg-card px-6 py-2 text-start font-medium">سهم پیش‌فرض</th>
                    <th scope="col" className="sticky top-0 bg-card px-6 py-2 text-start font-medium">وضعیت</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {visible.map((insurer) => (
                  <tr
                    key={insurer.id}
                    onClick={() => setEditing(insurer)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-app"
                  >
                    <td className="px-6 py-4">
                      <button type="button" className="text-primary hover:underline">
                        {insurer.name}
                      </button>
                    </td>
                    <td className="px-6 py-4">{months(insurer.delayMonths)}</td>
                    <td className="px-6 py-4">{faPercent(insurer.deductionRate)}</td>
                    <td className="px-6 py-4">{faPercent(insurer.defaultShare)}</td>
                    <td className="px-6 py-4">
                      <StatusBadge insurer={insurer} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="md:hidden">
              {visible.map((insurer) => (
                <li key={insurer.id} className="border-t border-line">
                  <button type="button" onClick={() => setEditing(insurer)} className="w-full p-4 text-start">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{insurer.name}</span>
                      <StatusBadge insurer={insurer} />
                    </span>
                    <span className="mt-1 block text-note text-muted">
                      تأخیر {months(insurer.delayMonths)}، کسورات {faPercent(insurer.deductionRate)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {editing && <InsurerForm draft={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
