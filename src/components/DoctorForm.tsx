import { useState } from 'react';
import type { Doctor, Insurer } from '../lib/db';
import { db } from '../lib/db';
import { FREE_KEY, mixProblem, SHIFT_LABEL, WEEK_DAYS, workDaysFromWeek } from '../lib/doctors';
import { faNumber } from '../lib/format';
import { normalizeText } from '../lib/text';
import { Badge, Button, ConfirmButton, Segmented } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { MoneyField, MonthField, MoreSettings, NumberField, PercentField, TextField } from './ui/fields';
import { useToast } from './ui/Toast';

export type DoctorDraft = Omit<Doctor, 'id'> & { id?: number };

type Shift = NonNullable<Doctor['shift']>;

/** فیلدهای پزشک؛ هم در فرم اصلی و هم در سناریو استفاده می‌شود. */
export function DoctorFields({
  value,
  insurers,
  onChange,
  scenario = false,
}: {
  value: DoctorDraft;
  insurers: Insurer[];
  onChange: (patch: Partial<DoctorDraft>) => void;
  scenario?: boolean;
}) {
  const days = value.weekDays ?? [];
  const problem = mixProblem(value.insurerMix);
  const mixTotal = Object.values(value.insurerMix).reduce((a, b) => a + b, 0);
  const orphans = Object.keys(value.insurerMix)
    .map(Number)
    .filter((key) => key !== FREE_KEY && !insurers.some((i) => i.id === key));
  const setMix = (key: number, share: number) => {
    const next = { ...value.insurerMix };
    if (share > 0) next[key] = share;
    else delete next[key];
    onChange({ insurerMix: next });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={scenario ? 'نام سناریو' : 'نام پزشک'} value={value.name} onChange={(e) => onChange({ name: e.target.value })} />
        <TextField label="تخصص" value={value.specialty} onChange={(e) => onChange({ specialty: e.target.value })} />
        <NumberField label="نسخه در روز" value={value.rxPerDay} onChange={(rxPerDay) => onChange({ rxPerDay })} />
        <NumberField
          label="روز کاری ماه"
          suffix="روز"
          hint="از روزهای هفته پر می‌شود و قابل تغییر است."
          value={value.workDays}
          onChange={(workDays) => onChange({ workDays })}
        />
      </div>

      <div>
        <p className="mb-1 text-note font-medium">روزهای کاری هفته</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="روزهای کاری هفته">
          {WEEK_DAYS.map((day, i) => {
            const on = days.includes(i);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? days.filter((d) => d !== i) : [...days, i].sort();
                  onChange({ weekDays: next, workDays: workDaysFromWeek(next) });
                }}
                className={`min-h-11 rounded-xl border px-2 text-note ${on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line text-muted'}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-note font-medium">شیفت</p>
        <Segmented<Shift>
          label="شیفت"
          value={value.shift ?? 'both'}
          onChange={(shift) => onChange({ shift })}
          options={(Object.keys(SHIFT_LABEL) as Shift[]).map((s) => ({ value: s, label: SHIFT_LABEL[s] }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField label="میانگین مبلغ نسخه (تخمینی)" value={value.avgRxAmount ?? 0} onChange={(avgRxAmount) => onChange({ avgRxAmount })} />
        <PercentField
          label="درصد پیچیده‌شده در این داروخانه"
          value={value.captureRate}
          onChange={(captureRate) => onChange({ captureRate })}
        />
      </div>

      <section aria-label="ترکیب بیمهٔ بیماران">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-note font-medium">ترکیب بیمهٔ بیماران</p>
          <Badge tone={problem ? 'bad' : 'good'}>جمع {faNumber(mixTotal * 100, 2)}٪</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {insurers.filter((i) => i.active || (value.insurerMix[i.id] ?? 0) > 0).map((insurer) => (
            <PercentField
              key={insurer.id}
              label={insurer.active ? insurer.name : `${insurer.name} (غیرفعال)`}
              value={value.insurerMix[insurer.id] ?? 0}
              onChange={(share) => setMix(insurer.id, share)}
            />
          ))}
          {orphans.map((key) => (
            <PercentField key={key} label="بیمهٔ حذف‌شده" value={value.insurerMix[key]} onChange={(share) => setMix(key, share)} />
          ))}
          <PercentField label="آزاد (بدون بیمه)" value={value.insurerMix[FREE_KEY] ?? 0} onChange={(share) => setMix(FREE_KEY, share)} />
        </div>
        {problem && <p className="mt-1 text-note text-bad" role="alert">{problem}</p>}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyField label="اجارهٔ مطب" value={value.officeRent} onChange={(officeRent) => onChange({ officeRent })} />
        <PercentField
          label="سهم داروخانه از اجاره"
          value={value.pharmacyRentShare}
          onChange={(pharmacyRentShare) => onChange({ pharmacyRentShare })}
        />
        <MoneyField label="کمک‌هزینهٔ ماهانه" value={value.monthlyAllowance} onChange={(monthlyAllowance) => onChange({ monthlyAllowance })} />
      </div>

      {!scenario && (
        <MoreSettings>
          <MonthField label="ماه شروع همکاری" value={value.startMonth} onChange={(startMonth) => onChange({ startMonth })} />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={value.active}
              onChange={(e) => onChange({ active: e.target.checked })}
            />
            این پزشک فعال است
          </label>
        </MoreSettings>
      )}
    </div>
  );
}

export function DoctorForm({
  draft,
  insurers,
  onClose,
}: {
  draft: DoctorDraft;
  insurers: Insurer[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(draft);
  const invalid = normalizeText(form.name) === '' || mixProblem(form.insurerMix) !== null;

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={form.id ? form.name : 'پزشک جدید'}
      footer={
        <>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={async () => {
              await db.doctors.put({ ...form, name: normalizeText(form.name), specialty: normalizeText(form.specialty) } as Doctor);
              toast('پزشک ذخیره شد');
              onClose();
            }}
          >
            ذخیره
          </Button>
          {form.id && (
            <ConfirmButton
              label="حذف پزشک"
              question="پزشک و پروفایل دارویی‌اش حذف شود؟"
              confirmLabel="حذف کن"
              onConfirm={async () => {
                await db.transaction('rw', db.doctors, db.doctorDrugProfile, async () => {
                  await db.doctorDrugProfile.where('doctorId').equals(form.id!).delete();
                  await db.doctors.delete(form.id!);
                });
                toast('پزشک حذف شد');
                onClose();
              }}
            />
          )}
        </>
      }
    >
      <DoctorFields value={form} insurers={insurers} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
    </Drawer>
  );
}
