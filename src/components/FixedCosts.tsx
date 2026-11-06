import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FixedCost, type OneOffCost } from '../lib/db';
import { faPercent } from '../lib/format';
import { currentMonthKey, monthLabel } from '../lib/jalali';
import { normalizeText } from '../lib/text';
import { Button, Card, CardTitle, ConfirmButton, SampleBadge } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { MoneyField, MonthField, MoreSettings, PercentField, TextField } from './ui/fields';
import { HowCalculated } from './ui/HowCalculated';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';

type FixedDraft = Omit<FixedCost, 'id'> & { id?: number };
type OneOffDraft = Omit<OneOffCost, 'id'> & { id?: number };

const monthlyOf = (c: Pick<FixedCost, 'amount' | 'pharmacyShare'>) => c.amount * (c.pharmacyShare ?? 1);

function FixedForm({ draft, onClose }: { draft: FixedDraft; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(draft);
  const set = <K extends keyof FixedDraft>(key: K) => (value: FixedDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? form.title : 'هزینهٔ ثابت تازه'}
      footer={
        <>
          <Button
            variant="primary"
            disabled={normalizeText(form.title) === ''}
            onClick={async () => {
              await db.fixedCosts.put(form as FixedCost);
              toast('هزینه ذخیره شد');
              onClose();
            }}
          >
            ذخیره
          </Button>
          {form.id && (
            <ConfirmButton
              label="حذف"
              question="این هزینه حذف شود؟"
              confirmLabel="حذف کن"
              onConfirm={async () => {
                await db.fixedCosts.delete(form.id!);
                onClose();
              }}
            />
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="عنوان" value={form.title} onChange={(e) => set('title')(e.target.value)} />
        <MoneyField label="مبلغ ماهانه" value={form.amount} onChange={set('amount')} />
        <PercentField
          label="سهم داروخانه"
          hint={<>هزینهٔ ماهانهٔ داروخانه: <Money rial={monthlyOf(form)} exact /></>}
          value={form.pharmacyShare ?? 1}
          onChange={set('pharmacyShare')}
        />
        <MoreSettings>
          <MonthField label="ماه شروع" value={form.startMonth} onChange={set('startMonth')} />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={Boolean(form.endMonth)}
              onChange={(e) => set('endMonth')(e.target.checked ? form.startMonth : undefined)}
            />
            ماه پایان دارد
          </label>
          {form.endMonth && <MonthField label="ماه پایان" value={form.endMonth} onChange={set('endMonth')} />}
        </MoreSettings>
      </div>
    </Drawer>
  );
}

function OneOffForm({ draft, onClose }: { draft: OneOffDraft; onClose: () => void }) {
  const [form, setForm] = useState(draft);
  const set = <K extends keyof OneOffDraft>(key: K) => (value: OneOffDraft[K]) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? form.title : 'هزینهٔ یک‌بارهٔ تازه'}
      footer={
        <>
          <Button
            variant="primary"
            disabled={normalizeText(form.title) === ''}
            onClick={async () => {
              await db.oneOffCosts.put(form as OneOffCost);
              onClose();
            }}
          >
            ذخیره
          </Button>
          {form.id && (
            <ConfirmButton
              label="حذف"
              question="این هزینه حذف شود؟"
              confirmLabel="حذف کن"
              onConfirm={async () => {
                await db.oneOffCosts.delete(form.id!);
                onClose();
              }}
            />
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="عنوان" value={form.title} onChange={(e) => set('title')(e.target.value)} />
        <MoneyField label="مبلغ" value={form.amount} onChange={set('amount')} />
        <MonthField label="ماه پرداخت" value={form.month} onChange={set('month')} />
      </div>
    </Drawer>
  );
}

/** هزینه‌های ثابت و یک‌باره؛ در صفحهٔ تنظیمات. */
export function FixedCosts() {
  const fixed = useLiveQuery(() => db.fixedCosts.toArray()) ?? [];
  const oneOff = useLiveQuery(() => db.oneOffCosts.toArray()) ?? [];
  const [editFixed, setEditFixed] = useState<FixedDraft | null>(null);
  const [editOne, setEditOne] = useState<OneOffDraft | null>(null);
  const month = currentMonthKey();
  const total = fixed.reduce((sum, c) => sum + monthlyOf(c), 0);

  return (
    <Card>
      <CardTitle note="اجارهٔ مطب و کمک‌هزینهٔ پزشکانی که در صفحهٔ پزشکان ثبت شده‌اند خودکار حساب می‌شود؛ آن‌ها را اینجا دوباره ننویسید.">
        هزینه‌های ثابت
      </CardTitle>
      <ul>
        {fixed.map((cost) => (
          <li key={cost.id} className="border-b border-line">
            <button type="button" onClick={() => setEditFixed(cost)} className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-start">
              <span className="flex flex-wrap items-center gap-2">
                {cost.title}
                {cost.sample && <SampleBadge />}
                {(cost.pharmacyShare ?? 1) !== 1 && <span className="text-note text-muted">سهم {faPercent(cost.pharmacyShare!)}</span>}
              </span>
              <Money rial={monthlyOf(cost)} exact />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 py-2 font-bold">
        <span className="flex items-center gap-4">
          جمع هزینهٔ ثابت ماهانه
          <HowCalculated
            title="جمع هزینهٔ ثابت ماهانه"
            formula="جمع مبلغ هر ردیف × سهم داروخانه"
            inputs={fixed.map((c) => [c.title, <Money rial={monthlyOf(c)} exact />])}
            result={['جمع', <Money rial={total} exact />]}
          />
        </span>
        <Money rial={total} exact />
      </div>
      <Button onClick={() => setEditFixed({ title: '', amount: 0, startMonth: month })}>افزودن هزینهٔ ثابت</Button>

      <h3 className="mt-6 mb-2 font-medium">هزینه‌های یک‌باره</h3>
      <ul>
        {oneOff.map((cost) => (
          <li key={cost.id} className="border-b border-line">
            <button type="button" onClick={() => setEditOne(cost)} className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-start">
              <span>{cost.title} <span className="text-note text-muted">{monthLabel(cost.month)}</span></span>
              <Money rial={cost.amount} exact />
            </button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={() => setEditOne({ title: '', amount: 0, month })}>افزودن هزینهٔ یک‌باره</Button>

      {editFixed && <FixedForm draft={editFixed} onClose={() => setEditFixed(null)} />}
      {editOne && <OneOffForm draft={editOne} onClose={() => setEditOne(null)} />}
    </Card>
  );
}
