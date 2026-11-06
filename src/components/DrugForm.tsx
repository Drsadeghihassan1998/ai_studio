import { useState } from 'react';
import type { Drug, Insurer } from '../lib/db';
import { saveManualDrug, type ManualDrug } from '../lib/drugbank';
import { normalizeText } from '../lib/text';
import { Button } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { Field, MoneyField, MoreSettings, PercentField, SelectBox, TextField } from './ui/fields';
import { useToast } from './ui/Toast';

/** افزودن یا ویرایش دستی؛ برای داروی آزاد یا دارویی که در فهرست‌ها نیست. */
export function DrugForm({
  drug,
  insurers,
  onClose,
  onSaved,
}: {
  drug?: Drug;
  insurers: Insurer[];
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ManualDrug>({
    id: drug?.id,
    name: drug?.genericName ?? '',
    form: drug?.form ?? '',
    dose: drug?.dose ?? '',
    code: '',
    price: drug?.price ?? 0,
    otc: drug?.otc ?? false,
    insurerId: null,
    coveredPrice: 0,
    shareRate: 0.7,
  });
  const set = <K extends keyof ManualDrug>(key: K) => (value: ManualDrug[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Drawer
      open
      onClose={onClose}
      title={drug ? 'ویرایش دارو' : 'داروی تازه'}
      footer={
        <Button
          variant="primary"
          disabled={normalizeText(form.name) === ''}
          onClick={async () => {
            const id = await saveManualDrug(form);
            toast('دارو ذخیره شد');
            onSaved(id);
          }}
        >
          ذخیره
        </Button>
      }
    >
      <div className="grid gap-4">
        <TextField label="نام دارو" value={form.name} onChange={(e) => set('name')(e.target.value)} />
        <MoneyField label="قیمت مصرف‌کننده" value={form.price} onChange={set('price')} />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={form.otc}
            onChange={(e) => set('otc')(e.target.checked)}
          />
          داروی آزاد است (کل مبلغ را بیمار می‌دهد)
        </label>
        {!form.otc && (
          <>
            <Field label="سهم بیمه" hint="اگر فقط سهم پیش‌فرض بیمه‌ها کافی است، خالی بگذارید.">
              {(id) => (
                <SelectBox
                  id={id}
                  value={form.insurerId === null ? '' : String(form.insurerId)}
                  onChange={(v) => set('insurerId')(v === '' ? null : Number(v))}
                  options={[
                    { value: '', label: 'بدون سهم اختصاصی' },
                    ...insurers.map((i) => ({ value: String(i.id), label: i.name })),
                  ]}
                />
              )}
            </Field>
            {form.insurerId !== null && (
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField label="قیمت مورد تعهد بیمه" value={form.coveredPrice} onChange={set('coveredPrice')} />
                <PercentField label="درصد سهم" value={form.shareRate} onChange={set('shareRate')} />
              </div>
            )}
          </>
        )}
        <MoreSettings>
          <TextField label="شکل" value={form.form} onChange={(e) => set('form')(e.target.value)} />
          <TextField label="دوز" value={form.dose} onChange={(e) => set('dose')(e.target.value)} />
          <TextField label="کد" value={form.code} onChange={(e) => set('code')(e.target.value)} />
        </MoreSettings>
      </div>
    </Drawer>
  );
}
