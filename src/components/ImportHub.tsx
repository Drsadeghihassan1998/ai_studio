import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ImportSlot } from '../lib/db';
import { faDate, faNumber } from '../lib/format';
import { isSlotOpen, SLOT_DEFS, type SlotDef } from '../lib/import';
import { Badge, Button, Card, KeyCard, PageHeader, PageSkeleton, type Tone } from './ui/basics';
import { ImportWizard } from './ImportWizard';

function statusOf(slot: SlotDef, saved?: ImportSlot): { label: string; tone: Tone } {
  if (saved?.status === 'imported') return { label: 'واردشده', tone: 'good' };
  if (saved?.status === 'mapped') return { label: 'نگاشت ذخیره شد', tone: 'neutral' };
  if (!isSlotOpen(slot)) return { label: `مرحلهٔ ${faNumber(slot.stage)}`, tone: 'neutral' };
  return { label: 'منتظر فایل', tone: 'warn' };
}

export function ImportHub() {
  const saved = useLiveQuery(() => db.importSlots.toArray());
  const [active, setActive] = useState<SlotDef | null>(null);

  if (!saved) return <PageSkeleton />;

  const imported = saved.filter((s) => s.status === 'imported');
  const lastDate = imported.map((s) => s.lastImportAt ?? '').sort().at(-1);

  return (
    <>
      <PageHeader title="مرکز ورود داده" note="فایل اکسل یا CSV را بدهید و ستون‌هایش را یک بار به برنامه معرفی کنید." />

      <div className="grid gap-4 sm:grid-cols-2">
        <KeyCard label="بخش‌های واردشده">
          {faNumber(imported.length)} <span className="text-body font-medium">از {faNumber(SLOT_DEFS.length)}</span>
        </KeyCard>
        <KeyCard label="آخرین ورود">{lastDate ? faDate(lastDate.slice(0, 10)) : <span className="text-muted">—</span>}</KeyCard>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {[...SLOT_DEFS].sort((a, b) => Number(b.id === 'coverage') - Number(a.id === 'coverage')).map((slot) => {
          const row = saved.find((s) => s.id === slot.id);
          const status = statusOf(slot, row);
          return (
            <Card key={slot.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-cardtitle font-medium">{slot.title}</h2>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <p className="flex-1 text-note text-muted">{slot.hint}</p>
              {row?.lastImportAt && (
                <p className="text-note text-muted">
                  آخرین ورود {faDate(row.lastImportAt.slice(0, 10))}، {faNumber(row.lastRowCount ?? 0)} ردیف
                </p>
              )}
              <div>
                <Button onClick={() => setActive(slot)}>{isSlotOpen(slot) ? 'ورود فایل' : 'معرفی ستون‌ها'}</Button>
              </div>
            </Card>
          );
        })}
      </div>

      {active && <ImportWizard slot={active} saved={saved.find((s) => s.id === active.id)} onClose={() => setActive(null)} />}
    </>
  );
}
